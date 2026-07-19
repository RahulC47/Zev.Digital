"""Local NLP extraction using spaCy — no cloud API keys needed.

Provides entity extraction (NER) and relationship extraction (dependency parsing)
as a lightweight offline alternative to LLM-based extraction.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Lazy-loaded spaCy model (15 MB, cached after first call)
_nlp = None

# Map spaCy NER labels to human-friendly entity types
_LABEL_MAP: dict[str, str] = {
    "PERSON": "Person",
    "ORG": "Organization",
    "GPE": "Location",
    "LOC": "Location",
    "FAC": "Facility",
    "DATE": "Date",
    "EVENT": "Event",
    "PRODUCT": "Product",
    "WORK_OF_ART": "Work",
    "LAW": "Law",
    "NORP": "Group",
    "MONEY": "Money",
    "QUANTITY": "Quantity",
    "TIME": "Time",
    "PERCENT": "Percent",
    "CARDINAL": "Number",
    "ORDINAL": "Number",
    "LANGUAGE": "Language",
}


_nlp_unavailable = False  # set True once a load failure is seen, to skip retries


def _get_nlp():
    global _nlp, _nlp_unavailable
    if _nlp_unavailable:
        return None
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load("en_core_web_sm")
            logger.info("spaCy en_core_web_sm loaded")
        except OSError:
            _nlp_unavailable = True
            logger.warning(
                "spaCy model 'en_core_web_sm' not found. "
                "Run: python -m spacy download en_core_web_sm  "
                "Graph extraction will be skipped until the model is installed."
            )
            return None
    return _nlp


def extract_entities(text: str) -> list[dict[str, Any]]:
    """Extract named entities from text using spaCy NER.

    Returns a list of dicts: [{name, label, start, end}].
    Deduplicates by name (case-insensitive), keeping the first occurrence's type.
    """
    nlp = _get_nlp()
    if nlp is None:
        return []
    doc = nlp(text)

    seen: dict[str, dict[str, Any]] = {}
    for ent in doc.ents:
        name = ent.text.strip()
        if not name or len(name) < 2:
            continue
        key = name.lower()
        if key not in seen:
            seen[key] = {
                "name": name,
                "label": _LABEL_MAP.get(ent.label_, "Entity"),
                "start": ent.start_char,
                "end": ent.end_char,
            }
    return list(seen.values())


def extract_relationships(
    text: str, entities: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Extract relationships between entities using dependency parsing + co-occurrence.

    Strategy:
    1. For each sentence containing 2+ entities, try to find SVO triples
       (subject → verb → object) connecting entity pairs.
    2. Fall back to co-occurrence: if two entities share a sentence, link them
       with the sentence's root verb as the relationship name.

    Returns: [{source_name, target_name, relation_name, fact}]
    """
    nlp = _get_nlp()
    if nlp is None:
        return []
    doc = nlp(text)

    # Build a lookup: lowered entity name → canonical name
    ent_names = {e["name"].lower(): e["name"] for e in entities}
    relationships: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for sent in doc.sents:
        sent_text = sent.text.strip()
        # Find which entities appear in this sentence
        sent_ents: list[str] = []
        for token in sent:
            for span_len in range(4, 0, -1):  # check multi-word spans
                span = doc[token.i : min(token.i + span_len, len(doc))].text.lower()
                if span in ent_names and ent_names[span] not in sent_ents:
                    sent_ents.append(ent_names[span])
                    break

        if len(sent_ents) < 2:
            continue

        # Find the root verb of the sentence for a fallback relation name
        root_verb = ""
        for token in sent:
            if token.dep_ == "ROOT" and token.pos_ in ("VERB", "AUX"):
                root_verb = token.lemma_
                break

        # Try SVO extraction first
        svo_found = _extract_svo(sent, ent_names, relationships, seen_pairs, sent_text)

        # Fallback: co-occurrence pairs
        if not svo_found:
            for i in range(len(sent_ents)):
                for j in range(i + 1, len(sent_ents)):
                    src, tgt = sent_ents[i], sent_ents[j]
                    pair = (src.lower(), tgt.lower())
                    if pair in seen_pairs or (pair[1], pair[0]) in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    rel = root_verb if root_verb else "related_to"
                    relationships.append({
                        "source_name": src,
                        "target_name": tgt,
                        "relation_name": rel,
                        "fact": sent_text,
                    })

    return relationships


def _extract_svo(sent, ent_names, relationships, seen_pairs, sent_text) -> bool:
    """Try to extract subject-verb-object triples from a sentence."""
    found = False
    for token in sent:
        if token.pos_ != "VERB":
            continue
        # Find subject and object children
        subjects = [
            c for c in token.children
            if c.dep_ in ("nsubj", "nsubjpass") and c.text.lower() in ent_names
        ]
        objects = [
            c for c in token.children
            if c.dep_ in ("dobj", "pobj", "attr", "oprd") and c.text.lower() in ent_names
        ]
        # Also check prep → pobj chains
        for child in token.children:
            if child.dep_ == "prep":
                for pobj in child.children:
                    if pobj.dep_ == "pobj" and pobj.text.lower() in ent_names:
                        objects.append(pobj)

        for subj in subjects:
            for obj in objects:
                src = ent_names[subj.text.lower()]
                tgt = ent_names[obj.text.lower()]
                pair = (src.lower(), tgt.lower())
                if pair in seen_pairs or (pair[1], pair[0]) in seen_pairs:
                    continue
                seen_pairs.add(pair)
                relationships.append({
                    "source_name": src,
                    "target_name": tgt,
                    "relation_name": token.lemma_,
                    "fact": sent_text,
                })
                found = True
    return found


def deduplicate_entities(
    extracted: list[dict[str, Any]],
    existing_names: list[str],
    threshold: int = 85,
) -> list[dict[str, Any]]:
    """Remove extracted entities that fuzzy-match an existing node name.

    Returns only the genuinely new entities (those below the threshold).
    """
    if not existing_names or not extracted:
        return extracted

    from rapidfuzz import fuzz

    new_entities: list[dict[str, Any]] = []
    for ent in extracted:
        best_score = 0
        for existing in existing_names:
            score = fuzz.ratio(ent["name"].lower(), existing.lower())
            if score > best_score:
                best_score = score
        if best_score < threshold:
            new_entities.append(ent)
        else:
            logger.debug(
                "Dedup: skipping '%s' (matches existing at %d%%)", ent["name"], best_score
            )
    return new_entities
