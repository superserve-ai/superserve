import os

from superserve import Superserve


def main():
    client = Superserve(api_key=os.environ["SUPERSERVE_API_KEY"])

    # Create a VM
    vm = client.vms.create(name="example-sandbox")
    print(f"Created VM: {vm.id}")

    # Execute a command
    result = client.vms.exec(vm.id, command="uname -a && echo 'Hello from Superserve!'")
    print(f"stdout: {result.stdout}")

    # Upload a file
    client.files.upload(vm.id, local_path="./hello.txt", remote_path="/home/user/hello.txt")
    print("Uploaded hello.txt")

    # Verify the upload
    cat = client.vms.exec(vm.id, command="cat /home/user/hello.txt")
    print(f"File contents: {cat.stdout}")

    # Checkpoint the VM
    checkpoint = client.checkpoints.create(vm.id, name="after-setup")
    print(f"Checkpoint created: {checkpoint.id}")

    # Make a change after the checkpoint
    client.vms.exec(vm.id, command="rm /home/user/hello.txt")

    # Fork from the checkpoint (hello.txt still exists in the fork)
    forked = client.vms.fork(vm.id, checkpoint_id=checkpoint.id, name="forked-sandbox")
    print(f"Forked VM: {forked.id}")

    verify = client.vms.exec(forked.id, command="cat /home/user/hello.txt")
    print(f"File in forked VM: {verify.stdout}")

    # Clean up
    client.vms.delete(forked.id)
    client.vms.delete(vm.id)
    print("Cleaned up VMs")


if __name__ == "__main__":
    main()
