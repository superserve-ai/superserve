require_relative "lib/superserve/version"

Gem::Specification.new do |spec|
  spec.name          = "superserve"
  spec.version       = Superserve::VERSION
  spec.authors       = ["Superserve"]
  spec.email         = ["support@superserve.ai"]

  spec.summary       = "Ruby SDK for the Superserve sandbox API"
  spec.description   = "Run code in isolated Firecracker MicroVMs from Ruby. " \
                       "Create sandboxes, execute commands, transfer files, and manage lifecycle."
  spec.homepage      = "https://superserve.ai"
  spec.license       = "Apache-2.0"
  spec.required_ruby_version = ">= 3.2.0"

  spec.metadata["homepage_uri"]      = spec.homepage
  spec.metadata["source_code_uri"]   = "https://github.com/superserve-ai/superserve"
  spec.metadata["bug_tracker_uri"]   = "https://github.com/superserve-ai/superserve/issues"
  spec.metadata["documentation_uri"] = "https://docs.superserve.ai/sdk/ruby/sandbox"

  spec.files = Dir.glob("lib/**/*.rb") + %w[README.md]
  spec.require_paths = ["lib"]

  spec.add_dependency "faraday", "~> 2.0"

  spec.add_development_dependency "rake", "~> 13.0"
  spec.add_development_dependency "rspec", "~> 3.13"
  spec.add_development_dependency "webmock", "~> 3.24"
end
