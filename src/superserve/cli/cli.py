#!/usr/bin/env python3
"""Superserve CLI - Deprecated. Use the new CLI instead."""

import sys


def main():
    """Main entry point - shows deprecation notice and exits."""
    print(
        "\n"
        "  ┌─────────────────────────────────────────────────────────┐\n"
        "  │                                                         │\n"
        "  │   The Python CLI (pip install superserve) is            │\n"
        "  │   deprecated and no longer maintained.                  │\n"
        "  │                                                         │\n"
        "  │   Install the new CLI:                                  │\n"
        "  │                                                         │\n"
        "  │     curl -fsSL https://superserve.ai/install | sh       │\n"
        "  │                                                         │\n"
        "  │   Or via npm:                                           │\n"
        "  │                                                         │\n"
        "  │     npm install -g @superserve/cli                      │\n"
        "  │                                                         │\n"
        "  │   Or via Homebrew:                                      │\n"
        "  │                                                         │\n"
        "  │     brew install superserve-ai/tap/superserve           │\n"
        "  │                                                         │\n"
        "  │   Then uninstall this package:                          │\n"
        "  │                                                         │\n"
        "  │     pip uninstall superserve                            │\n"
        "  │                                                         │\n"
        "  └─────────────────────────────────────────────────────────┘\n"
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
