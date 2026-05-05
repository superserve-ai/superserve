# Superserve Ruby SDK — end-to-end demo
#
# Run from packages/ruby-sdk/:
#   export SUPERSERVE_API_KEY=ss_live_...
#   bundle exec ruby examples/demo.rb

require_relative "../lib/superserve"

def step(title)
  puts
  puts "─" * 64
  puts "▶ #{title}"
  puts "─" * 64
end

# ----------------------------------------------------------------
step "Creating a sandbox"
# ----------------------------------------------------------------
sandbox = Superserve::Sandbox.create(
  name: "ruby-sdk-demo",
  metadata: { "demo" => "ruby-sdk" }
)
puts "  id:     #{sandbox.id}"
puts "  status: #{sandbox.status}"
puts "  vcpu:   #{sandbox.get_info.vcpu_count}, mem: #{sandbox.get_info.memory_mib} MiB"

# ----------------------------------------------------------------
step "Running a sync command"
# ----------------------------------------------------------------
result = sandbox.commands.run("ruby -e 'puts (1..10).map { |i| i**2 }.sum'")
puts "  stdout:    #{result.stdout.strip}"
puts "  exit_code: #{result.exit_code}"

# ----------------------------------------------------------------
step "Round-tripping a file through the data plane"
# ----------------------------------------------------------------
sandbox.files.write("/tmp/note.txt", "hello from the ruby sdk")
echoed = sandbox.files.read_text("/tmp/note.txt")
puts "  wrote: /tmp/note.txt"
puts "  read:  #{echoed.inspect}"

# ----------------------------------------------------------------
step "Streaming command output (SSE)"
# ----------------------------------------------------------------
sandbox.commands.run(
  %q(ruby -e '5.times { |i| puts "chunk #{i+1}"; STDOUT.flush; sleep 0.3 }'),
  on_stdout: ->(chunk) { print "  STREAM ▸ #{chunk}" }
)

# ----------------------------------------------------------------
step "Pause + resume (rotates the per-sandbox access token)"
# ----------------------------------------------------------------
sandbox.pause
puts "  paused."
sandbox.resume
puts "  resumed (access token rotated, files re-bound)."
echoed_again = sandbox.files.read_text("/tmp/note.txt")
puts "  files still work: #{echoed_again.inspect}"

# ----------------------------------------------------------------
step "Listing sandboxes filtered by metadata"
# ----------------------------------------------------------------
matches = Superserve::Sandbox.list(metadata: { "demo" => "ruby-sdk" })
puts "  matched #{matches.length} sandbox(es) with demo=ruby-sdk"
matches.each { |s| puts "    - #{s.id} (#{s.status})" }

# ----------------------------------------------------------------
step "Cleaning up"
# ----------------------------------------------------------------
sandbox.kill
puts "  killed. (kill is idempotent — safe to call again)"
sandbox.kill rescue nil
puts "  second kill: no-op."

puts
puts "✓ Demo complete."
