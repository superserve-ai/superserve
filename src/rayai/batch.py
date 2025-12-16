"""Generic batch tool for parallel execution of any registered tool.

This module provides a flexible BatchTool that allows LLMs to call any
registered tool by name with multiple inputs in parallel using Ray.
"""

from collections.abc import Callable
from typing import Any

import ray
from pydantic import BaseModel, Field

from rayai.adapters.core import RayTool, to_raytool


class BatchToolInput(BaseModel):
    """Input schema for BatchTool - exposed to LLMs."""

    tool_name: str = Field(description="Name of the tool to execute")
    tool_inputs: list[dict[str, Any]] = Field(
        description="List of input dictionaries, one per tool invocation"
    )


class BatchToolOutput(BaseModel):
    """Output schema for BatchTool results."""

    results: list[Any] = Field(
        description="Results from each tool invocation (None if error occurred)"
    )
    errors: list[str | None] = Field(
        description="Error messages for each invocation (None if success)"
    )
    tool_name: str = Field(description="Name of the tool that was executed")
    count: int = Field(description="Number of inputs processed")


class BatchTool:
    """Generic batch tool for parallel execution of any registered tool.

    BatchTool is itself a tool that can be converted to LangChain/Pydantic AI
    via RayToolWrapper. When called by an LLM, it:
    1. Resolves the tool by name
    2. Validates inputs against the tool's schema (optional)
    3. Executes all inputs in parallel on Ray
    4. Returns structured output with results and per-item errors

    Example:
        >>> batch_tool = BatchTool(tools=[search_tool, fetch_tool])
        >>> result = batch_tool(
        ...     tool_name="search",
        ...     tool_inputs=[{"query": "a"}, {"query": "b"}, {"query": "c"}]
        ... )
    """

    def __init__(
        self,
        tools: list[Callable | RayTool] | None = None,
        description: str | None = None,
        name: str = "batch",
        validate_inputs: bool = True,
    ):
        """Initialize BatchTool.

        Args:
            tools: List of tools to register (names inferred from __name__)
            description: Custom description for the batch tool
            name: Name for the batch tool (default: "batch")
            validate_inputs: Whether to validate inputs against tool schema
        """
        self._tools: dict[str, Callable | RayTool] = {}
        self._name = name
        self._validate_inputs = validate_inputs
        self._description = description or self._default_description()

        if tools:
            for tool in tools:
                self._register(tool)

        self._setup_tool_metadata()

    def _default_description(self) -> str:
        return (
            "Execute multiple calls to any registered tool in parallel. "
            "Provide the tool name and a list of input dictionaries. "
            "Returns results and any errors for each input."
        )

    def _setup_tool_metadata(self) -> None:
        """Set up metadata so BatchTool can be used as a tool itself."""
        self.__name__ = self._name
        self.__qualname__ = self._name
        self.__doc__ = self._description

        self.__annotations__ = {
            "tool_name": str,
            "tool_inputs": list[dict[str, Any]],
            "return": dict[str, Any],
        }

        self.args_schema = BatchToolInput

        self._tool_metadata = {
            "desc": self._description,
            "is_batch_tool": True,
        }

    def _register(self, tool: Callable | RayTool, name: str | None = None) -> None:
        """Register a tool (internal)."""
        if name is None:
            if isinstance(tool, RayTool):
                name = tool.name
            elif hasattr(tool, "__name__"):
                name = tool.__name__
            else:
                raise ValueError("Cannot infer tool name, provide explicitly")

        self._tools[name] = tool

    def _list_tools(self) -> list[str]:
        """List all registered tool names."""
        return list(self._tools.keys())

    @property
    def name(self) -> str:
        """Tool name."""
        return self._name

    @property
    def description(self) -> str:
        """Tool description."""
        return self._description

    def _resolve(self, name: str) -> RayTool | None:
        """Resolve a tool by name to RayTool."""
        tool = self._tools.get(name)
        if tool is None:
            return None

        if isinstance(tool, RayTool):
            return tool
        return to_raytool(tool)

    def __call__(
        self,
        tool_name: str,
        tool_inputs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Execute batch tool calls.

        Args:
            tool_name: Name of tool to execute
            tool_inputs: List of input dicts for each invocation

        Returns:
            Dict with results, errors, tool_name, count
        """
        if not tool_inputs:
            return BatchToolOutput(
                results=[],
                errors=[],
                tool_name=tool_name,
                count=0,
            ).model_dump()

        ray_tool = self._resolve(tool_name)
        if ray_tool is None:
            available = self._list_tools()
            error_msg = f"Tool '{tool_name}' not found. Available: {available}"
            return BatchToolOutput(
                results=[None] * len(tool_inputs),
                errors=[error_msg] * len(tool_inputs),
                tool_name=tool_name,
                count=len(tool_inputs),
            ).model_dump()

        if self._validate_inputs and ray_tool.args_schema:
            validation_errors = self._validate_all_inputs(
                ray_tool.args_schema, tool_inputs
            )
            if any(validation_errors):
                return BatchToolOutput(
                    results=[None] * len(tool_inputs),
                    errors=validation_errors,
                    tool_name=tool_name,
                    count=len(tool_inputs),
                ).model_dump()

        results, errors = self._execute_parallel(ray_tool, tool_inputs)

        return BatchToolOutput(
            results=results,
            errors=errors,
            tool_name=tool_name,
            count=len(tool_inputs),
        ).model_dump()

    def _validate_all_inputs(
        self,
        schema: type[BaseModel],
        inputs: list[dict[str, Any]],
    ) -> list[str | None]:
        """Validate all inputs against schema."""
        errors: list[str | None] = []
        for i, inp in enumerate(inputs):
            try:
                schema.model_validate(inp)
                errors.append(None)
            except Exception as e:
                errors.append(f"Input {i} validation error: {e}")
        return errors

    def _execute_parallel(
        self,
        ray_tool: RayTool,
        inputs: list[dict[str, Any]],
    ) -> tuple[list[Any], list[str | None]]:
        """Execute inputs in parallel on Ray."""
        ray_remote = ray_tool.ray_remote
        input_style = ray_tool.input_style

        refs = []
        for inp in inputs:
            if input_style == "single_input":
                if len(inp) == 1:
                    refs.append(ray_remote.remote(next(iter(inp.values()))))
                else:
                    refs.append(ray_remote.remote(inp))
            else:
                refs.append(ray_remote.remote(**inp))

        results: list[Any] = []
        errors: list[str | None] = []

        for i, ref in enumerate(refs):
            try:
                result = ray.get(ref)
                results.append(self._handle_result(result))
                errors.append(None)
            except Exception as e:
                results.append(None)
                errors.append(f"Execution error for input {i}: {str(e)}")

        return results, errors

    def _handle_result(self, result: Any) -> Any:
        """Handle result from Ray task."""
        if isinstance(result, dict) and "status" in result:
            if result["status"] == "error":
                raise RuntimeError(result.get("error", "Unknown error"))
            if "result" in result:
                return result["result"]
        return result


__all__ = ["BatchTool", "BatchToolInput", "BatchToolOutput"]
