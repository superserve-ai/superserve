require "webmock/rspec"
require "superserve"

WebMock.disable_net_connect!

RSpec.configure do |config|
  config.expect_with :rspec do |c|
    c.syntax = :expect
  end
  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end
  config.disable_monkey_patching!
  config.order = :random

  config.around(:each) do |example|
    saved_env = ENV.to_h.slice("SUPERSERVE_API_KEY", "SUPERSERVE_BASE_URL")
    ENV["SUPERSERVE_API_KEY"] = "ss_live_test_key"
    ENV["SUPERSERVE_BASE_URL"] = "https://api.test.local"
    example.run
    ENV.delete("SUPERSERVE_API_KEY")
    ENV.delete("SUPERSERVE_BASE_URL")
    saved_env.each { |k, v| ENV[k] = v }
  end
end

module Superserve
  module SpecHelpers
    BASE = "https://api.test.local".freeze

    def stub_api(method, path, status: 200, body: nil, headers: {})
      stub = stub_request(method, "#{BASE}#{path}")
      stub.with(headers: { "X-API-Key" => "ss_live_test_key" })
      response_body = body.is_a?(String) ? body : JSON.generate(body || {})
      stub.to_return(
        status: status,
        body: response_body,
        headers: headers.merge("Content-Type" => "application/json")
      )
    end

    def sandbox_response(overrides = {})
      {
        "id" => "sb_123",
        "name" => "test",
        "status" => "active",
        "vcpu_count" => 2,
        "memory_mib" => 1024,
        "access_token" => "tok_abc",
        "created_at" => "2026-01-01T00:00:00Z",
        "metadata" => {}
      }.merge(overrides)
    end

    def template_response(overrides = {})
      {
        "id" => "tpl_123",
        "name" => "test-tpl",
        "team_id" => "team_xyz",
        "status" => "ready",
        "vcpu" => 2,
        "memory_mib" => 1024,
        "disk_mib" => 8192,
        "created_at" => "2026-01-01T00:00:00Z"
      }.merge(overrides)
    end

    def build_response(overrides = {})
      {
        "id" => "bld_123",
        "template_id" => "tpl_123",
        "status" => "ready",
        "build_spec_hash" => "abc123",
        "created_at" => "2026-01-01T00:00:00Z"
      }.merge(overrides)
    end
  end
end

RSpec.configure { |c| c.include Superserve::SpecHelpers }
