from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..storage import ROOT, read_json
from .base import AgentProvider, DisabledProvider
from .codex import CodexProvider
from .command import CommandProvider


DISABLED_VALUES = {"0", "false", "off", "none", "disabled"}


@dataclass(frozen=True)
class ProviderSelection:
    provider: AgentProvider
    source: str
    name: str


def resolve_provider(
    *,
    env: dict[str, str],
    task_kind: str,
    command_env: str | None = None,
    provider_env: str | None = None,
) -> ProviderSelection:
    if command_env:
        command_value = env.get(command_env, "").strip()
        if command_value.casefold() in DISABLED_VALUES:
            return ProviderSelection(
                provider=DisabledProvider(reason=_disabled_reason(task_kind), detail=f"{command_env} disabled provider execution"),
                source=command_env,
                name="disabled",
            )
        if command_value:
            return ProviderSelection(
                provider=CommandProvider(command_value, name=f"command:{command_env}"),
                source=command_env,
                name="command",
            )

    provider_name = ""
    if provider_env:
        provider_name = env.get(provider_env, "").strip()
        if provider_name:
            selection = _provider_by_name(provider_name, env=env, source=provider_env)
            if selection:
                return selection

    global_provider = env.get("STUDY_BUDDY_AGENT_PROVIDER", "").strip()
    if global_provider:
        selection = _provider_by_name(global_provider, env=env, source="STUDY_BUDDY_AGENT_PROVIDER")
        if selection:
            return selection

    config = _provider_config()
    configured_default = str(config.get("default_provider") or "auto").strip()
    selection = _provider_by_name(configured_default or "auto", env=env, source="config/agent_providers.json")
    if selection:
        return selection
    return ProviderSelection(
        provider=DisabledProvider(reason=_not_found_reason(task_kind), detail="No supported agent provider is configured or installed"),
        source="auto",
        name="disabled",
    )


def provider_diagnostics(env: dict[str, str]) -> dict[str, Any]:
    config = _provider_config()
    providers = {
        "codex": {
            "available": CodexProvider(_codex_executable(config)).available(),
            "enabled": _provider_enabled(config, "codex", True),
            "executable": _codex_executable(config),
        },
        "custom": {
            "available": bool(env.get(_custom_command_env(config), "").strip()),
            "enabled": _provider_enabled(config, "custom", True),
            "command_env": _custom_command_env(config),
        },
    }
    selections = {}
    for kind, command_env, provider_env in [
        ("quiz_subagent", "SUBAGENT_SOLVER_COMMAND", "SUBAGENT_SOLVER_PROVIDER"),
        ("document_build_section", "DOCUMENT_BUILD_SECTION_COMMAND", "DOCUMENT_BUILD_SECTION_PROVIDER"),
        ("study_build_builder", "STUDY_BUILD_BUILDER_COMMAND", "STUDY_BUILD_BUILDER_PROVIDER"),
        ("study_build_reviewer", "STUDY_BUILD_REVIEWER_COMMAND", "STUDY_BUILD_REVIEWER_PROVIDER"),
    ]:
        selection = resolve_provider(env=env, task_kind=kind, command_env=command_env, provider_env=provider_env)
        selections[kind] = {"provider": selection.name, "source": selection.source, "available": selection.provider.available()}
    return {
        "default_provider": env.get("STUDY_BUDDY_AGENT_PROVIDER") or config.get("default_provider") or "auto",
        "providers": providers,
        "selections": selections,
    }


def _provider_by_name(name: str, *, env: dict[str, str], source: str) -> ProviderSelection | None:
    normalized = name.casefold()
    if normalized in DISABLED_VALUES:
        return ProviderSelection(provider=DisabledProvider(), source=source, name="disabled")
    if normalized in {"auto", ""}:
        return _auto_provider(env=env, source=source)
    config = _provider_config()
    if normalized == "codex":
        if not _provider_enabled(config, "codex", True):
            return ProviderSelection(provider=DisabledProvider(detail="codex provider is disabled in config"), source=source, name="disabled")
        return ProviderSelection(provider=CodexProvider(_codex_executable(config)), source=source, name="codex")
    if normalized in {"custom", "command", "shell"}:
        command_env = _custom_command_env(config)
        command = env.get(command_env, "").strip()
        if command.casefold() in DISABLED_VALUES:
            return ProviderSelection(provider=DisabledProvider(detail=f"{command_env} disabled provider execution"), source=command_env, name="disabled")
        if not command:
            return ProviderSelection(provider=DisabledProvider(reason="agent-command-not-configured", detail=f"{command_env} is empty"), source=command_env, name="disabled")
        return ProviderSelection(provider=CommandProvider(command, name=f"command:{command_env}"), source=command_env, name="command")
    return ProviderSelection(provider=DisabledProvider(reason="agent-provider-unknown", detail=f"Unknown provider: {name}"), source=source, name="disabled")


def _auto_provider(*, env: dict[str, str], source: str) -> ProviderSelection:
    config = _provider_config()
    if _provider_enabled(config, "codex", True):
        codex = CodexProvider(_codex_executable(config))
        if codex.available():
            return ProviderSelection(provider=codex, source=source, name="codex")
    if _provider_enabled(config, "custom", True):
        command_env = _custom_command_env(config)
        command = env.get(command_env, "").strip()
        if command and command.casefold() not in DISABLED_VALUES:
            return ProviderSelection(provider=CommandProvider(command, name=f"command:{command_env}"), source=command_env, name="command")
    return ProviderSelection(provider=DisabledProvider(reason="agent-command-not-found", detail="No auto-detected provider is available"), source=source, name="disabled")


def _provider_config() -> dict[str, Any]:
    payload = read_json(ROOT / "config" / "agent_providers.json", default={})
    return payload if isinstance(payload, dict) else {}


def _provider_enabled(config: dict[str, Any], name: str, default: bool) -> bool:
    providers = config.get("providers") if isinstance(config.get("providers"), dict) else {}
    provider_config = providers.get(name) if isinstance(providers.get(name), dict) else {}
    return bool(provider_config.get("enabled", default))


def _codex_executable(config: dict[str, Any]) -> str:
    providers = config.get("providers") if isinstance(config.get("providers"), dict) else {}
    codex = providers.get("codex") if isinstance(providers.get("codex"), dict) else {}
    return str(codex.get("executable") or "codex")


def _custom_command_env(config: dict[str, Any]) -> str:
    providers = config.get("providers") if isinstance(config.get("providers"), dict) else {}
    custom = providers.get("custom") if isinstance(providers.get("custom"), dict) else {}
    return str(custom.get("command_env") or "STUDY_BUDDY_AGENT_COMMAND")


def _disabled_reason(task_kind: str) -> str:
    return "subagent-command-disabled" if task_kind == "quiz_subagent" else "model-command-disabled"


def _not_found_reason(task_kind: str) -> str:
    return "subagent-command-not-found" if task_kind == "quiz_subagent" else "model-command-not-found"
