"""LLM client that forces json_object mode instead of json_schema structured outputs.

DeepSeek and many OpenRouter models reject `response_format: {type: json_schema}`.
This subclass replaces json_schema with json_object and injects the schema into
the system prompt so the model still produces the right structure.
"""
from __future__ import annotations

import json
import logging
import typing

import openai
from pydantic import BaseModel

from graphiti_core.llm_client.errors import RateLimitError
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.prompts.models import Message

logger = logging.getLogger(__name__)


class JsonObjectClient(OpenAIGenericClient):
    """OpenAI-compatible client that always uses json_object mode.

    Suitable for DeepSeek and OpenRouter models that don't support json_schema
    structured outputs. The Pydantic response model's JSON schema is appended to
    the system prompt so the model still returns the expected fields.
    """

    async def _generate_response(
        self,
        messages: list[Message],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = 8192,
        model_size=None,
    ) -> dict[str, typing.Any]:
        from openai.types.chat import ChatCompletionMessageParam

        openai_messages: list[ChatCompletionMessageParam] = []

        # If we have a structured model, inject its schema into the system message
        schema_hint = ""
        if response_model is not None:
            schema = response_model.model_json_schema()
            schema_hint = (
                f"\n\nRespond with a valid JSON object matching this schema:\n"
                f"{json.dumps(schema, indent=2)}"
            )

        for m in messages:
            m.content = self._clean_input(m.content)
            if m.role == "system":
                openai_messages.append({"role": "system", "content": m.content + schema_hint})
                schema_hint = ""  # only inject once
            elif m.role == "user":
                openai_messages.append({"role": "user", "content": m.content})

        # If there was no system message, prepend one with just the schema hint
        if schema_hint:
            openai_messages.insert(0, {"role": "system", "content": schema_hint.strip()})

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=openai_messages,
                temperature=self.temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},  # always — no json_schema
            )
            result = response.choices[0].message.content or "{}"
            # Strip markdown code fences if the model wraps its output
            result = result.strip()
            if result.startswith("```"):
                result = result.split("```")[1]
                if result.startswith("json"):
                    result = result[4:]
            return json.loads(result)
        except openai.RateLimitError as e:
            raise RateLimitError from e
        except Exception as e:
            logger.error("JsonObjectClient error: %s", e)
            raise
