"""Record operation counts and timings without logging mail, queries, or tokens."""
from contextlib import contextmanager
import logging
from time import monotonic

from langchain_core.callbacks import BaseCallbackHandler

logger = logging.getLogger("uvicorn.error")


@contextmanager
def timed_operation(kind, name, count=1):
    started = monotonic()
    outcome = "ok"
    try:
        yield
    except BaseException:
        outcome = "error"
        raise
    finally:
        logger.info("operation kind=%s name=%s count=%s elapsed_ms=%d outcome=%s",
                    kind, name, count, (monotonic() - started) * 1000, outcome)


class ModelUsageLogger(BaseCallbackHandler):
    def __init__(self, provider, model):
        self.provider = provider
        self.model = model
        self.started = {}

    def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
        self.started[run_id] = monotonic()

    def on_llm_end(self, response, *, run_id, **kwargs):
        usage = (response.llm_output or {}).get("token_usage", {})
        if not usage:
            usage = getattr(response.generations[0][0].message, "usage_metadata", None) or {}
        self._log(run_id, "ok", usage)

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._log(run_id, type(error).__name__, {})

    def _log(self, run_id, outcome, usage):
        now = monotonic()
        logger.info("model provider=%s name=%s elapsed_ms=%d outcome=%s input_tokens=%s output_tokens=%s",
                    self.provider, self.model, (now - self.started.pop(run_id, now)) * 1000, outcome,
                    usage.get("input_tokens", usage.get("prompt_tokens")),
                    usage.get("output_tokens", usage.get("completion_tokens")))
