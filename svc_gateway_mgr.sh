#!/bin/sh
set -e
exec /opt/svc_gateway_mgr/app.js 2>&1 >> /var/log/svc_gateway_mgr
