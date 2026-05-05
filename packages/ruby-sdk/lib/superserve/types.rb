require "time"

module Superserve
  # Sandbox status — string values matching API enum.
  module SandboxStatus
    ACTIVE = "active".freeze
    PAUSED = "paused".freeze
    RESUMING = "resuming".freeze
    FAILED = "failed".freeze
    ALL = [ACTIVE, PAUSED, RESUMING, FAILED].freeze
  end

  module TemplateStatus
    PENDING = "pending".freeze
    BUILDING = "building".freeze
    READY = "ready".freeze
    FAILED = "failed".freeze
    ALL = [PENDING, BUILDING, READY, FAILED].freeze
  end

  module TemplateBuildStatus
    PENDING = "pending".freeze
    BUILDING = "building".freeze
    SNAPSHOTTING = "snapshotting".freeze
    READY = "ready".freeze
    FAILED = "failed".freeze
    CANCELLED = "cancelled".freeze
    ALL = [PENDING, BUILDING, SNAPSHOTTING, READY, FAILED, CANCELLED].freeze
  end

  module BuildLogStream
    STDOUT = "stdout".freeze
    STDERR = "stderr".freeze
    SYSTEM = "system".freeze
    ALL = [STDOUT, STDERR, SYSTEM].freeze
  end

  NetworkConfig = Data.define(:allow_out, :deny_out)

  SandboxInfo = Data.define(
    :id, :name, :status, :vcpu_count, :memory_mib,
    :created_at, :timeout_seconds, :network, :metadata
  )

  CommandResult = Data.define(:stdout, :stderr, :exit_code)

  TemplateInfo = Data.define(
    :id, :name, :team_id, :status, :vcpu, :memory_mib, :disk_mib,
    :size_bytes, :error_message, :created_at, :built_at, :latest_build_id
  )

  TemplateBuildInfo = Data.define(
    :id, :template_id, :status, :build_spec_hash,
    :error_message, :started_at, :finalized_at, :created_at
  )

  BuildLogEvent = Data.define(:timestamp, :stream, :text, :finished, :status)

  # BuildStep variants are plain hashes — Ruby is duck-typed, no validation enforced:
  #   { run: "echo hello" }
  #   { env: { key: "FOO", value: "bar" } }
  #   { workdir: "/app" }
  #   { user: { name: "deploy", sudo: true } }

  # Parse an ISO 8601 / RFC 3339 datetime string. Handles trailing "Z" UTC.
  def self.parse_iso8601(value)
    return nil if value.nil?
    Time.iso8601(value)
  end

  def self.to_sandbox_info(raw)
    raise SandboxError.new("Invalid API response: missing sandbox id") unless raw["id"]
    raise SandboxError.new("Invalid API response: missing sandbox status") unless raw["status"]
    raise SandboxError.new("Invalid API response: missing created_at") unless raw["created_at"]

    network = nil
    if raw["network"].is_a?(Hash)
      network = NetworkConfig.new(
        allow_out: raw["network"]["allow_out"],
        deny_out: raw["network"]["deny_out"]
      )
    end

    SandboxInfo.new(
      id: raw["id"],
      name: raw["name"] || "",
      status: raw["status"],
      vcpu_count: raw["vcpu_count"] || 0,
      memory_mib: raw["memory_mib"] || 0,
      created_at: parse_iso8601(raw["created_at"]),
      timeout_seconds: raw["timeout_seconds"],
      network: network,
      metadata: raw["metadata"] || {}
    )
  end

  def self.to_template_info(raw, latest_build_id = nil)
    raise SandboxError.new("Invalid API response: missing template id") unless raw["id"]
    raise SandboxError.new("Invalid API response: missing template name") unless raw["name"]
    raise SandboxError.new("Invalid API response: missing template status") unless raw["status"]
    raise SandboxError.new("Invalid API response: missing team_id") unless raw["team_id"]
    raise SandboxError.new("Invalid API response: missing created_at") unless raw["created_at"]

    TemplateInfo.new(
      id: raw["id"],
      name: raw["name"],
      team_id: raw["team_id"],
      status: raw["status"],
      vcpu: raw["vcpu"] || 0,
      memory_mib: raw["memory_mib"] || 0,
      disk_mib: raw["disk_mib"] || 0,
      size_bytes: raw["size_bytes"],
      error_message: raw["error_message"],
      created_at: parse_iso8601(raw["created_at"]),
      built_at: parse_iso8601(raw["built_at"]),
      latest_build_id: latest_build_id || raw["latest_build_id"]
    )
  end

  def self.to_template_build_info(raw)
    raise SandboxError.new("Invalid API response: missing build id") unless raw["id"]
    raise SandboxError.new("Invalid API response: missing template_id") unless raw["template_id"]
    raise SandboxError.new("Invalid API response: missing build status") unless raw["status"]
    raise SandboxError.new("Invalid API response: missing build_spec_hash") unless raw["build_spec_hash"]
    raise SandboxError.new("Invalid API response: missing created_at") unless raw["created_at"]

    TemplateBuildInfo.new(
      id: raw["id"],
      template_id: raw["template_id"],
      status: raw["status"],
      build_spec_hash: raw["build_spec_hash"],
      error_message: raw["error_message"],
      started_at: parse_iso8601(raw["started_at"]),
      finalized_at: parse_iso8601(raw["finalized_at"]),
      created_at: parse_iso8601(raw["created_at"])
    )
  end

  def self.to_build_log_event(raw)
    raise SandboxError.new("Invalid log event: missing timestamp") unless raw["timestamp"]
    raise SandboxError.new("Invalid log event: missing stream") unless raw["stream"]

    BuildLogEvent.new(
      timestamp: parse_iso8601(raw["timestamp"]),
      stream: raw["stream"],
      text: raw["text"] || "",
      finished: raw["finished"],
      status: raw["status"]
    )
  end
end
