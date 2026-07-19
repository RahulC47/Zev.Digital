"""Quick smoke test: verify spaCy, fastembed, rapidfuzz all import and run."""
import spacy

nlp = spacy.load("en_core_web_sm")
doc = nlp("Alice founded Acme in 2020 and hired Bob")
print("Entities:", [(ent.text, ent.label_) for ent in doc.ents])

from fastembed import TextEmbedding
model = TextEmbedding("BAAI/bge-small-en-v1.5")
emb = list(model.embed(["hello world"]))[0]
print(f"Embedding dim: {len(emb)}")

from rapidfuzz import fuzz
print(f"Fuzzy match Bob/Robert: {fuzz.ratio('Bob', 'Robert')}")

print("All imports OK")
