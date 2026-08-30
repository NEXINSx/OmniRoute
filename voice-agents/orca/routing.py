from dataclasses import dataclass
import re
import unicodedata
from collections.abc import Mapping


ROUTE_ALIASES = {
    "research": ("recherchiere", "quellen", "fakten", "wettbewerber"),
    "tiktok-concept": ("kanal", "nische", "reichweite", "konzept"),
    "tiktok-video-producer": ("short", "tiktok", "video", "produzieren", "voice", "bilder"),
    "youtube-upload": ("youtube", "hochladen", "upload", "veröffentlichen"),
}
STOP_WORDS = {"der", "die", "das", "ein", "eine", "und", "zu", "für", "mit", "den", "dem", "über", "einen", "mir"}


@dataclass(frozen=True)
class RoutingDecision:
    skill: str
    confidence: float
    reason: str
    matched_terms: tuple[str, ...] = ()


def _tokens(value: object) -> set[str]:
    text = unicodedata.normalize("NFKC", str(value)).casefold()
    return {token for token in re.findall(r"[\wÄÖÜäöüß]+", text, re.UNICODE) if token not in STOP_WORDS}


def _values(skill_name: str, definition: Mapping[str, object]) -> tuple[set[str], set[str], set[str]]:
    name_tokens = _tokens(skill_name)
    aliases = set(_tokens(ROUTE_ALIASES.get(skill_name, ()))) | set(_tokens(definition.get("aliases", ())))
    description = set(_tokens(definition.get("description", "")))
    pipeline = definition.get("pipeline", ()) or ()
    pipeline_tokens: set[str] = set()
    for step in pipeline:
        if isinstance(step, Mapping):
            pipeline_tokens |= _tokens(step.get("type", ""))
    return name_tokens, aliases, description | pipeline_tokens


def route_command(text: str, skill_defs: Mapping[str, Mapping[str, object]] | None = None) -> RoutingDecision:
    command_tokens = _tokens(text)
    if not command_tokens:
        raise ValueError("command text required")
    if skill_defs is None:
        from orca.skills import list_skills
        skill_defs = list_skills()
    if "daily-brainstorm" not in skill_defs:
        raise LookupError("fallback skill daily-brainstorm not found")

    scored = []
    for name, definition in skill_defs.items():
        name_tokens, aliases, other_tokens = _values(name, definition)
        exact_aliases = command_tokens & aliases
        exact_names = command_tokens & name_tokens
        other = command_tokens & other_tokens
        score = len(exact_aliases) * 4 + len(exact_names) * 3 + len(other)
        scored.append((score, name, tuple(sorted(exact_aliases | exact_names | other))))
    scored.sort(reverse=True)
    best = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0
    if best[0] <= 0 or best[0] - second_score < 1 or best[1] == "daily-brainstorm":
        return RoutingDecision("daily-brainstorm", 0.0, "Fallback: kein eindeutiger Skill-Treffer", ())
    confidence = min(1.0, best[0] / 12.0)
    terms = best[2][:3]
    return RoutingDecision(best[1], confidence, "Treffer für: " + ", ".join(terms), terms)
