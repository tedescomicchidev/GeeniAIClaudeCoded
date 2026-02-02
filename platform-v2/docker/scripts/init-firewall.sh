#!/bin/bash
set -euo pipefail

# Initialize iptables firewall for agent containers
# This script limits outbound connections to approved domains via the Squid proxy

# Only run if we have iptables available
if ! command -v iptables &> /dev/null; then
    echo "iptables not available, skipping firewall setup"
    exit 0
fi

# Get proxy address from environment
PROXY_HOST="${HTTP_PROXY:-}"
if [ -z "$PROXY_HOST" ]; then
    echo "No proxy configured, skipping firewall setup"
    exit 0
fi

# Extract proxy IP/port
PROXY_IP=$(echo "$PROXY_HOST" | sed 's|http://||' | cut -d':' -f1)
PROXY_PORT=$(echo "$PROXY_HOST" | sed 's|http://||' | cut -d':' -f2)

echo "Configuring firewall to route traffic through proxy at $PROXY_IP:$PROXY_PORT"

# Flush existing rules
iptables -F OUTPUT 2>/dev/null || true

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (needed for proxy hostname resolution)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow connection to the proxy
iptables -A OUTPUT -p tcp -d "$PROXY_IP" --dport "$PROXY_PORT" -j ACCEPT

# Allow internal cluster communication
iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT
iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT
iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT

# Drop all other outbound traffic
iptables -A OUTPUT -j DROP

echo "Firewall configured successfully"
