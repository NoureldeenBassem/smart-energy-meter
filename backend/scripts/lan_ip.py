"""
Print this machine's LAN IPv4 address — the one an ESP32 on the same network
would use to reach it — and nothing else.

    python scripts/lan_ip.py     ->  192.168.40.111

Used by start-wattwise.cmd to check that firmware/config.py still points at the
right address. Routers hand out new leases, and a stale MQTT_BROKER_HOST looks
exactly like a wiring fault on the board.

WHY NOT ENUMERATE INTERFACES
============================
Listing adapters and filtering out loopback, link-local, WSL and Hyper-V is
fragile — the names differ per machine and per Windows version, and this box has
both a Wi-Fi and an Ethernet address. Opening a UDP socket toward a public
address instead makes the OS's own routing table pick the interface it would
actually send from, which is the one that matters. No packet is sent; UDP
connect() only sets the destination.
"""

import socket


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Any routable address works; 8.8.8.8 is never contacted.
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        # No default route (no network at all). Report loopback rather than
        # crashing — the caller only needs something to compare against.
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print(lan_ip())
