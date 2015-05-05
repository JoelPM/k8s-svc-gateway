#!/bin/sh
set -e
exec /opt/k8s-svc-gw-mgr/app.js 2>&1 >> /var/log/k8s-svc-gw-mgr.log
