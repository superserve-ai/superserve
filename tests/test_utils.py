"""Tests for superserve CLI utility functions."""

from superserve.cli.utils import format_timestamp


class TestFormatTimestamp:
    """Tests for format_timestamp."""

    def test_empty_string(self):
        assert format_timestamp("") == ""

    def test_full_format_utc_z(self):
        result = format_timestamp("2026-02-16T04:31:05.837895Z")
        # Should be converted to local time, no T separator
        assert "T" not in result
        assert ":" in result

    def test_full_format_utc_offset(self):
        result = format_timestamp("2026-02-16T04:31:05+00:00")
        assert "T" not in result
        assert ":" in result

    def test_short_format(self):
        result = format_timestamp("2026-02-16T04:31:05Z", short=True)
        # Short format: "Feb 15 20:31" (month abbrev, no seconds)
        assert len(result) <= 12
        assert ":" in result

    def test_short_has_no_seconds(self):
        result = format_timestamp("2026-02-16T12:30:45Z", short=True)
        # Should only have one colon (HH:MM, no seconds)
        assert result.count(":") == 1

    def test_full_has_seconds(self):
        result = format_timestamp("2026-02-16T12:30:45Z")
        # Full format: YYYY-MM-DD HH:MM:SS
        assert result.count(":") == 2

    def test_fallback_on_invalid(self):
        result = format_timestamp("not-a-timestamp")
        assert result == "not-a-timestamp"[:16]

    def test_none_like_empty(self):
        assert format_timestamp("") == ""
