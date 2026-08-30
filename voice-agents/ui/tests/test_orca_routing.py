import pytest

from orca.routing import route_command


SKILLS = {
    "daily-brainstorm": {"description": "Tagesinspiration und Ideen"},
    "research": {"description": "Recherche, Quellen und Wettbewerber"},
    "tiktok-concept": {"description": "Kanal, Nische, Reichweite und Konzept"},
    "tiktok-video-producer": {"description": "TikTok Short Video produzieren mit Bildern und Voice"},
    "youtube-upload": {"description": "YouTube Short hochladen und veröffentlichen"},
}


def test_routes_video_command_to_video_producer():
    decision = route_command("Erstelle einen TikTok Short über den Hamburger Hafen mit Stimme", SKILLS)
    assert decision.skill == "tiktok-video-producer"
    assert decision.confidence >= 0.5
    assert "video" in decision.reason.lower() or "short" in decision.reason.lower()


def test_routes_research_command_to_research():
    decision = route_command("Recherchiere Quellen und Wettbewerber zum Thema", SKILLS)
    assert decision.skill == "research"
    assert decision.confidence >= 0.5


def test_routes_youtube_command_to_upload():
    decision = route_command("Lade den fertigen Short bei YouTube hoch", SKILLS)
    assert decision.skill == "youtube-upload"


def test_unknown_command_falls_back_to_daily_brainstorm():
    decision = route_command("Erzähl mir etwas völlig Unklares", SKILLS)
    assert decision.skill == "daily-brainstorm"
    assert decision.confidence == 0.0
    assert "fallback" in decision.reason.lower()


def test_empty_command_raises_value_error():
    with pytest.raises(ValueError, match="command text required"):
        route_command("   ", SKILLS)
