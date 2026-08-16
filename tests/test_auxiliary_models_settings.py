"""Tests for auxiliary models settings UI — panels.js + index.html + i18n.js.

Verifies that the auxiliary models card is present in the settings HTML,
that the JS loading/saving logic is wired up, and that all locales have the
required i18n keys.
"""
import json
import shutil
import subprocess

from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parent.parent
STREAMING_PY = (ROOT / "api" / "streaming.py").read_text(encoding="utf-8")
NODE = shutil.which("node")




class TestAuxiliaryModelsJS:
    """The JS logic for loading and saving auxiliary models must be in panels.js."""


    def test_main_extra_body_flows_to_agent_request_overrides(self):
        """Persisted main extra_body must be passed to AIAgent, not only shown in Settings."""
        assert "_main_model_request_overrides" in STREAMING_PY
        assert "'request_overrides' in _agent_params" in STREAMING_PY
        assert "_agent_kwargs['request_overrides'] = _main_request_overrides" in STREAMING_PY
        assert "_main_request_overrides or {}" in STREAMING_PY


class TestAuxiliaryModelsI18n:
    """All locales must have the auxiliary model i18n keys."""

    REQUIRED_KEYS = [
        "settings_label_auxiliary_models",
        "settings_desc_auxiliary_models",
        "settings_btn_reset_aux_models",
        "settings_btn_apply_aux_models",
        "settings_aux_provider_auto",
        "settings_aux_model_auto",
        "settings_aux_model_custom",
        "settings_aux_model_custom_prompt",
        "settings_aux_loading",
        "settings_aux_load_failed",
        "settings_aux_reset_confirm_title",
        "settings_aux_reset_confirm_msg",
        "settings_aux_reset_done",
        "settings_aux_save_failed",
        "settings_aux_saved",
        "settings_aux_no_changes",
        "settings_aux_advanced_button_title",
        "settings_aux_advanced_button_aria",
        "settings_aux_advanced_title",
        "settings_aux_advanced_subtitle",
        "settings_aux_advanced_save",
        "settings_aux_advanced_base_url",
        "settings_aux_advanced_base_url_desc",
        "settings_aux_advanced_timeout",
        "settings_aux_advanced_timeout_desc",
        "settings_aux_advanced_download_timeout",
        "settings_aux_advanced_download_timeout_desc",
        "settings_aux_advanced_max_concurrency",
        "settings_aux_advanced_max_concurrency_desc",
        "settings_aux_advanced_extra_body",
        "settings_aux_advanced_extra_body_desc",
        "settings_aux_advanced_api_key",
        "settings_aux_advanced_api_key_set_hint",
        "settings_aux_advanced_api_key_empty_hint",
        "settings_aux_advanced_api_key_clear",
        "settings_aux_advanced_extra_body_invalid_json",
        "settings_aux_advanced_extra_body_object_required",
        "settings_aux_advanced_saved",
        "settings_aux_advanced_save_failed",
        "settings_main_advanced_button_aria",
        "settings_main_advanced_title",
        "settings_main_advanced_subtitle",
        "settings_main_advanced_saved",
        "settings_main_advanced_save_failed",
        "settings_main_advanced_service_tier",
        "settings_main_advanced_service_tier_desc",
        "settings_main_advanced_service_tier_default",
        "settings_main_advanced_service_tier_priority",
        "settings_aux_task_vision",
        "settings_aux_task_vision_desc",
        "settings_aux_task_compression",
        "settings_aux_task_compression_desc",
        "settings_aux_task_web_extract",
        "settings_aux_task_web_extract_desc",
        "settings_aux_task_approval",
        "settings_aux_task_approval_desc",
        "settings_aux_task_mcp",
        "settings_aux_task_mcp_desc",
        "settings_aux_task_title_generation",
        "settings_aux_task_title_generation_desc",
        "settings_aux_task_skills_hub",
        "settings_aux_task_skills_hub_desc",
        "settings_aux_task_curator",
        "settings_aux_task_curator_desc",
        "settings_aux_task_kanban_decomposer",
        "settings_aux_task_kanban_decomposer_desc",
        "settings_aux_task_profile_describer",
        "settings_aux_task_profile_describer_desc",
        "settings_aux_task_triage_specifier",
        "settings_aux_task_triage_specifier_desc",
    ]


class TestAuxiliaryModelsBackend:
    """WebUI backend must expose /api/model/auxiliary and /api/model/set."""

    ROUTES_PY = (ROOT / "api" / "routes.py").read_text(encoding="utf-8")
    CONFIG_PY = (ROOT / "api" / "config.py").read_text(encoding="utf-8")

    def test_model_auxiliary_route_exists(self):
        """/api/model/auxiliary route must be registered in routes.py."""
        assert '"/api/model/auxiliary"' in self.ROUTES_PY, (
            "Missing /api/model/auxiliary route in routes.py"
        )

    def test_model_set_route_exists(self):
        """/api/model/set route must be registered in routes.py."""
        assert '"/api/model/set"' in self.ROUTES_PY, (
            "Missing /api/model/set route in routes.py"
        )

    def test_default_model_routes_drop_auxiliary_auto_provider_sentinel(self, monkeypatch):
        from api import routes

        seen = []

        monkeypatch.setattr(routes, "_csrf_exempt_path", lambda _path: True)
        monkeypatch.setattr(routes, "j", lambda _handler, payload, **_kwargs: payload)

        def fake_set_default_model(model, provider=None, advanced=None):
            seen.append({
                "model": model,
                "provider": provider,
                "advanced": advanced,
            })
            return {"ok": True, "model": model, "provider": provider}

        monkeypatch.setattr(routes, "set_hermes_default_model", fake_set_default_model)

        bodies = {
            "/api/default-model": {
                "model": "gpt-5.5",
                "provider": "auto",
                "advanced": {"base_url": "https://example.invalid/v1"},
            },
            "/api/model/set": {
                "scope": "main",
                "model": "gpt-5.5",
                "provider": "auto",
                "advanced": {"base_url": "https://example.invalid/v1"},
            },
        }

        for path, body in bodies.items():
            monkeypatch.setattr(routes, "read_body", lambda _handler, payload=body: payload)
            routes.handle_post(object(), SimpleNamespace(path=path, query=""))

        assert seen == [
            {
                "model": "gpt-5.5",
                "provider": None,
                "advanced": {"base_url": "https://example.invalid/v1"},
            },
            {
                "model": "gpt-5.5",
                "provider": None,
                "advanced": {"base_url": "https://example.invalid/v1"},
            },
        ]

    def test_get_auxiliary_models_function_exists(self):
        """get_auxiliary_models() must exist in api/config.py."""
        assert "def get_auxiliary_models" in self.CONFIG_PY, (
            "Missing get_auxiliary_models() in api/config.py"
        )

    def test_backend_aux_task_slots_include_agent_defaults(self):
        """Backend allow-list must include newer Hermes auxiliary slots."""
        for key in ("kanban_decomposer", "profile_describer", "triage_specifier"):
            assert f'"{key}"' in self.CONFIG_PY

    def test_backend_surfaces_advanced_fields_without_api_key_value(self, monkeypatch):
        """Advanced fields should be visible, but API keys remain write-only."""
        from api import config

        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "cfg", {
            "model": {"provider": "openai", "default": "gpt-5.5"},
            "auxiliary": {
                "vision": {
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "base_url": "https://example.invalid/v1",
                    "timeout": 42,
                    "download_timeout": 7,
                    "max_concurrency": 2,
                    "extra_body": {"reasoning_effort": "none"},
                    "api_key": "DUMMY_KEY_DO_NOT_RETURN",
                }
            },
        })

        data = config.get_auxiliary_models()
        vision = next(t for t in data["tasks"] if t["task"] == "vision")
        assert vision["base_url"] == "https://example.invalid/v1"
        assert vision["timeout"] == 42
        assert vision["download_timeout"] == 7
        assert vision["max_concurrency"] == 2
        assert vision["extra_body"] == {"reasoning_effort": "none"}
        assert vision["api_key_set"] is True
        assert "api_key" not in vision

    def test_get_auxiliary_models_omits_session_search_and_includes_metadata(self, monkeypatch):
        """Backend payload should omit unknown keys and keep canonical metadata."""
        from api import config

        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "cfg", {
            "model": {"provider": "openai", "default": "gpt-5.5"},
            "auxiliary": {
                "vision": {"provider": "openai", "model": "gpt-5.5"},
                "future_task": {
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "label": "Future Task",
                    "description": "future tool",
                },
                "monitor": {"provider": "openai", "model": "gpt-5.5"},
                "tts_audio_tags": {"provider": "openai", "model": "gpt-5.5"},
            },
        })

        data = config.get_auxiliary_models()
        task_keys = [t["task"] for t in data["tasks"]]
        assert task_keys == [
            "vision",
            "web_extract",
            "compression",
            "approval",
            "mcp",
            "title_generation",
            "skills_hub",
            "curator",
            "kanban_decomposer",
            "profile_describer",
            "triage_specifier",
        ]
        assert "session_search" not in task_keys
        assert "future_task" not in task_keys
        assert "monitor" not in task_keys
        assert "tts_audio_tags" not in task_keys
        vision = next(t for t in data["tasks"] if t["task"] == "vision")
        assert vision["label"] == "Vision"
        assert vision["description"] == "image/screenshot analysis"

    def test_set_auxiliary_model_rejects_existing_unknown_task(self, monkeypatch, tmp_path):
        """Existing unknown keys must be rejected by the auxiliary setter."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text(
            "auxiliary:\n  future_task:\n    provider: openai\n    model: gpt-5.5\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)

        with pytest.raises(ValueError, match="Unknown auxiliary task slot") as excinfo:
            config.set_auxiliary_model("future_task", "openai", "gpt-5.6")
        assert "future_task" in str(excinfo.value)

    def test_reset_removes_retired_slot_but_preserves_other_unknown_mappings(
        self, monkeypatch, tmp_path
    ):
        """Reset cleans known retired slots without treating config as task schema."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text(
            "auxiliary:\n"
            "  vision:\n"
            "    provider: openai\n"
            "    model: gpt-5.5\n"
            "  session_search:\n"
            "    provider: openai\n"
            "    model: gpt-5.5\n"
            "  monitor:\n"
            "    provider: openai\n"
            "    model: gpt-5.5\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)

        config.set_auxiliary_model("__reset__", "auto", "")

        saved = config._load_yaml_config_file(config_path)["auxiliary"]
        assert "session_search" not in saved
        assert saved["monitor"] == {"provider": "openai", "model": "gpt-5.5"}
        assert saved["vision"]["provider"] == "auto"
        assert saved["vision"]["model"] == ""

    def test_backend_surfaces_main_advanced_fields_without_api_key_value(self, monkeypatch):
        """Main model advanced fields should be visible, but API keys remain write-only."""
        from api import config

        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "cfg", {
            "model": {
                "provider": "openai",
                "default": "gpt-5.5",
                "base_url": "https://example.invalid/v1",
                "timeout": 42,
                "download_timeout": 7,
                "max_concurrency": 2,
                "extra_body": {"reasoning_effort": "none"},
                "api_key": "DUMMY_KEY_DO_NOT_RETURN",
            },
            "auxiliary": {},
        })

        data = config.get_auxiliary_models()
        main = data["main"]
        assert main["base_url"] == "https://example.invalid/v1"
        assert main["timeout"] == 42
        assert main["download_timeout"] == 7
        assert main["max_concurrency"] == 2
        assert main["extra_body"] == {"reasoning_effort": "none"}
        assert main["api_key_set"] is True
        assert "api_key" not in main

    def test_set_auxiliary_model_function_exists(self):
        """set_auxiliary_model() must exist in api/config.py."""
        assert "def set_auxiliary_model" in self.CONFIG_PY, (
            "Missing set_auxiliary_model() in api/config.py"
        )

    def test_aux_task_slots_constant_exists(self):
        """AUX_TASK_SLOTS must be defined in api/config.py."""
        assert "AUX_TASK_SLOTS" in self.CONFIG_PY, (
            "Missing AUX_TASK_SLOTS constant in api/config.py"
        )


    def test_set_auxiliary_model_rejects_unknown_task(self, monkeypatch, tmp_path):
        """Unknown auxiliary task names must not pollute config.yaml."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("auxiliary: {}\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)

        try:
            config.set_auxiliary_model("arbitrary_key", "openai", "gpt-5.5")
        except ValueError as exc:
            assert "Unknown auxiliary task slot" in str(exc)
            assert "vision" in str(exc)
        else:
            raise AssertionError("set_auxiliary_model accepted an unknown task")

        assert "arbitrary_key" not in config_path.read_text(encoding="utf-8")

    def test_set_hermes_default_model_persists_advanced_options(self, monkeypatch, tmp_path):
        """Main-model gear-modal payload should persist supported model options."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("model:\n  provider: openai\n  default: gpt-5.5\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "invalidate_models_cache", lambda: None)
        monkeypatch.setattr(config, "resolve_model_provider", lambda model: (model, "openai", None))

        result = config.set_hermes_default_model(
            "gpt-5.5",
            advanced={
                "base_url": "https://example.invalid/v1/",
                "timeout": "45",
                "download_timeout": "9",
                "max_concurrency": "2",
                "extra_body": {"reasoning_effort": "none"},
                "api_key": "DUMMY_KEY_DO_NOT_PRINT",
            },
        )

        assert result["ok"] is True
        text = config_path.read_text(encoding="utf-8")
        assert "https://example.invalid/v1" in text
        assert "timeout: 45" in text
        assert "download_timeout: 9" in text
        assert "max_concurrency: 2" in text
        assert "reasoning_effort: none" in text
        assert "DUMMY_KEY_DO_NOT_PRINT" in text

    def test_set_hermes_default_model_persists_explicit_provider_override(self, monkeypatch, tmp_path):
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("model:\n  provider: openai\n  default: gpt-5.5\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "invalidate_models_cache", lambda: None)
        monkeypatch.setattr(config, "resolve_model_provider", lambda model: (model, "", None))

        result = config.set_hermes_default_model("gpt-5.5", provider="anthropic")

        assert result["ok"] is True
        assert result["provider"] == "anthropic"
        text = config_path.read_text(encoding="utf-8")
        assert "provider: anthropic" in text

    def test_set_hermes_default_model_provider_override_replaces_stale_custom_base_url(self, monkeypatch, tmp_path):
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("model:\n  provider: custom\n  default: gpt-5.5\n  base_url: http://old.local/v1\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "invalidate_models_cache", lambda: None)
        monkeypatch.setattr(config, "resolve_model_provider", lambda model: (model, "custom", "http://old.local/v1"))

        result = config.set_hermes_default_model("gpt-5.5", provider="openai")

        assert result["ok"] is True
        saved = config_path.read_text(encoding="utf-8")
        assert "provider: openai" in saved
        assert "base_url: https://api.openai.com/v1" in saved
        assert "http://old.local/v1" not in saved

    def test_set_auxiliary_model_persists_advanced_options(self, monkeypatch, tmp_path):
        """Gear-modal payload should persist supported per-slot options."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("auxiliary:\n  vision:\n    provider: auto\n    model: ''\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)

        result = config.set_auxiliary_model(
            "vision",
            "openai",
            "gpt-5.5",
            advanced={
                "base_url": "https://example.invalid/v1/",
                "timeout": "45",
                "download_timeout": "9",
                "max_concurrency": "2",
                "extra_body": {"reasoning_effort": "none"},
                "api_key": "DUMMY_KEY_DO_NOT_PRINT",
            },
        )

        assert result["ok"] is True
        text = config_path.read_text(encoding="utf-8")
        assert "https://example.invalid/v1" in text
        assert "timeout: 45" in text
        assert "download_timeout: 9" in text
        assert "max_concurrency: 2" in text
        assert "reasoning_effort: none" in text
        assert "DUMMY_KEY_DO_NOT_PRINT" in text

    def test_set_auxiliary_model_explicit_advanced_base_url_wins_over_custom_resolution(self, monkeypatch, tmp_path):
        """Custom-provider auto-resolution must not clobber an explicit gear base_url."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("auxiliary:\n  vision:\n    provider: auto\n    model: ''\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(
            config,
            "resolve_model_provider",
            lambda model: (model, "custom:demo", "https://resolved.invalid/v1"),
        )

        result = config.set_auxiliary_model(
            "vision",
            "custom:demo",
            "demo/model",
            advanced={"base_url": "https://manual.invalid/v1/"},
        )

        assert result["ok"] is True
        text = config_path.read_text(encoding="utf-8")
        assert "https://manual.invalid/v1" in text
        assert "https://resolved.invalid/v1" not in text

    def test_main_extra_body_becomes_runtime_request_overrides(self):
        """The main-model extra_body option is live only if it reaches request_overrides."""
        from api import config

        cfg = {
            "model": {
                "provider": "openai",
                "default": "gpt-5.5",
                "extra_body": {"reasoning_effort": "none"},
            }
        }

        overrides = config._main_model_request_overrides(cfg)

        assert overrides == {"extra_body": {"reasoning_effort": "none"}}
        assert overrides["extra_body"] is not cfg["model"]["extra_body"]


    def test_set_hermes_default_model_clear_api_key_removes_key(self, monkeypatch, tmp_path):
        """Clearing a write-only API key override should remove the key, not persist api_key: ''."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text(
            "model:\n  provider: openai\n  default: gpt-5.5\n  api_key: old-secret\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)
        monkeypatch.setattr(config, "invalidate_models_cache", lambda: None)
        monkeypatch.setattr(config, "resolve_model_provider", lambda model: (model, "openai", None))

        result = config.set_hermes_default_model(
            "gpt-5.5",
            advanced={"api_key_clear": True, "api_key": ""},
        )

        assert result["ok"] is True
        text = config_path.read_text(encoding="utf-8")
        assert "old-secret" not in text
        assert "api_key" not in text

    def test_set_auxiliary_model_clears_empty_extra_body(self, monkeypatch, tmp_path):
        """Blank extra_body from the modal should remove config noise instead of writing {}."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text(
            "auxiliary:\n  vision:\n    provider: openai\n    model: gpt-5.5\n    extra_body:\n      reasoning_effort: none\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)
        monkeypatch.setattr(config, "reload_config", lambda: None)

        result = config.set_auxiliary_model("vision", "openai", "gpt-5.5", advanced={"extra_body": {}})

        assert result["ok"] is True
        assert "extra_body" not in config_path.read_text(encoding="utf-8")

    def test_set_auxiliary_model_validates_extra_body_object(self, monkeypatch, tmp_path):
        """extra_body must stay an object, not arbitrary JSON."""
        from api import config

        config_path = tmp_path / "config.yaml"
        config_path.write_text("auxiliary: {}\n", encoding="utf-8")
        monkeypatch.setattr(config, "_get_config_path", lambda: config_path)

        try:
            config.set_auxiliary_model("vision", "openai", "gpt-5.5", advanced={"extra_body": ["bad"]})
        except ValueError as exc:
            assert "extra_body must be a JSON object" in str(exc)
        else:
            raise AssertionError("set_auxiliary_model accepted non-object extra_body")

    def test_model_set_route_returns_400_for_unknown_auxiliary_task(self, monkeypatch):
        """The route should surface invalid auxiliary task names as a client error."""
        from types import SimpleNamespace
        from api import routes

        monkeypatch.setattr(routes, "_check_csrf", lambda _handler: True)
        monkeypatch.setattr(routes, "read_body", lambda _handler: {
            "scope": "auxiliary",
            "task": "arbitrary_key",
            "provider": "openai",
            "model": "gpt-5.5",
        })
        monkeypatch.setattr(
            routes,
            "bad",
            lambda _handler, msg, status=400: {"ok": False, "error": msg, "status": status},
        )

        result = routes.handle_post(object(), SimpleNamespace(path="/api/model/set"))

        assert result["status"] == 400
        assert "Unknown auxiliary task slot" in result["error"]
