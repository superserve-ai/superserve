"""Resource allocation decorators for Ray agents."""

from typing import Any


def ray_resources(
    num_cpus: int = 1,
    memory: str = "2GB",
    num_replicas: int = 1,
    num_gpus: int = 0,
):
    """
    Decorator to specify resource allocation for agent deployments.

    Simple decorator for agent developers to specify the most common
    resource requirements for their agents.

    Args:
        num_cpus: Number of CPU cores per replica (default: 1)
        memory: Memory allocation per replica (default: "2GB")
        num_replicas: Number of agent replicas to run (default: 1)
        num_gpus: Number of GPUs per replica (default: 0)

    Example:
        @ray_resources(num_cpus=2, memory="4GB", num_replicas=3)
        class ChatbotAgent(RayAgent):
            def run(self, data):
                return {"response": "Hello with 2 CPUs and 4GB memory!"}

        @ray_resources(num_gpus=1, memory="8GB")
        class ImageAgent(RayAgent):
            def run(self, data):
                return {"response": "Processing images with GPU!"}
    """

    def decorator(cls):
        resource_config = {
            "num_cpus": num_cpus,
            "memory": memory,
            "num_replicas": num_replicas,
            "num_gpus": num_gpus,
        }

        cls._ray_resources = resource_config

        return cls

    return decorator


def get_agent_resources(agent_class) -> dict[str, Any]:
    """
    Extract resource configuration from an agent class.

    Args:
        agent_class: Agent class that may have @ray_resources decorator

    Returns:
        Dict containing resource configuration, empty if no decorator
    """
    return getattr(agent_class, "_ray_resources", {})


def has_resource_config(agent_class) -> bool:
    """
    Check if an agent class has resource configuration.

    Args:
        agent_class: Agent class to check

    Returns:
        True if the class has @ray_resources decorator applied
    """
    return hasattr(agent_class, "_ray_resources")
