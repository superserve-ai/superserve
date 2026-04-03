# Superserve CLI

Create and manage cloud micro-VMs from the terminal.

## Install

```bash
bun add -g @superserve/cli
```

## Usage

```bash
# Authenticate
superserve login

# Create a VM
superserve vm create --name my-sandbox --image ubuntu-22.04

# Execute a command
superserve exec vm_abc123 "echo hello"

# Upload/download files
superserve files upload vm_abc123 ./script.py /home/user/script.py
superserve files download vm_abc123 /home/user/output.txt

# SSH into a VM
superserve ssh vm_abc123

# Checkpoint, rollback, fork
superserve checkpoint create vm_abc123 --name baseline
superserve rollback vm_abc123 --name baseline
superserve fork vm_abc123 --count 2

# VM lifecycle
superserve vm stop vm_abc123
superserve vm start vm_abc123
superserve vm sleep vm_abc123
superserve vm wake vm_abc123
superserve vm delete vm_abc123
```

## Documentation

See [docs.superserve.ai](https://docs.superserve.ai) for full documentation.
