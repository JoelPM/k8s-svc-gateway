#!/usr/bin/env node

var exec = require('child_process').exec;
var express = require('express');
var fs = require('fs');
var hogan = require('hogan.js');
var http = require('http');
var path = require('path');
var program = require('commander');

var PATH_RULE = "path";
var HOST_RULE = "host";

program.version('1.0.0')
    .option(
         '-h, --host [host]',
         'Kubernetes host to query. Env var $SVC_GW_K8S_API_HOST. Defaults to $KUBERNETES_RO_SERVICE_HOST.')
    .option(
         '-p, --prefix [prefix]',
         'Annotation prefix to use. Env var $SVC_GW_PREFIX. Default is "svcproxy."')
    .option(
         '-e, --err-prefix [err_prefix]',
         'Annotation error prefix to use. Env var $SVC_GW_ERR_PREFIX. Default is "err.svcproxy."')
    .option(
         '-c, --cidr [cidr]',
         'Annotation whitelist cidr block prefix to use. Env var $SVC_GW_CIDR. Default is "cidr."')
    .option(
         '-d, --default-cidr [default_cidr]',
         'Default whitelist cidr block to use if specified. Env var $SVC_GW_CIDR_DEFAULT. Defaults to undefined.')
    .option(
         '-i, --interval [val]',
         'Interval on which to poll for new or removed services in seconds. Env var $SVC_GW_INTERVAL. Defaults to 60.')
    .option(
         '-l, --listen [val]',
         'Port on which built-in web interface should listen. Env var SVC_GW_MGR_PORT. Defaults to 9090.')
    .option(
         '-x, --exposed-path-port [exposed_path_port]',
         'Port on which path proxy interface should listen. Env var SVC_GW_EXPOSED_PATH_PROXY_PORT. Defaults to 80.')
    .option(
         '-o, --default-host-port [default_host_port]',
         'Default port on which host proxy interfaces should listen. Env var SVC_GW_DEFAULT_HOST_PORT. Defaults to 80.')
    .option(
         '-f, --exposed-host-port-prefix [exposed_host_port_prefix]',
         'Annotation exposed host port prefix to use. Env var $SVC_GW_EXPOSED_HOST_PORT_PREFIX. Default is "port.svcproxy."')
    .parse(process.argv);

var k8s_host = program.host || process.env.SVC_GW_K8S_API_HOST ||
               process.env.KUBERNETES_RO_SERVICE_HOST;
var prefix = program.prefix || process.env.SVC_GW_PREFIX || "svcgateway.";
var err_prefix =
    program.err_prefix || process.env.SVC_GW_ERR_PREFIX || "err.svcgateway.";
var cidr_prefix = program.cidr || process.env.SVC_GW_CIDR || "cidr.";
var cidr_default_str =
    program.cidr || process.env.SVC_GW_CIDR_DEFAULT || undefined;
var interval = program.interval || process.env.SVC_GW_INTERVAL || 60;
var mgr_port = program.listen || process.env.SVC_GW_MGR_PORT || 9090;
var exposed_path_port = program.exposed_path_port ||
                        process.env.SVC_GW_EXPOSED_PATH_PROXY_PORT || 80;
var default_host_port =
    program.default_host_port || process.env.SVC_GW_DEFAULT_HOST_PORT || 80;
var exposed_host_port_prefix = program.exposed_host_port_prefix ||
                               process.env.SVC_GW_EXPOSED_HOST_PORT_PREFIX ||
                               "port.svcproxy.";

var cidr_default =
    (typeof(cidr_default_str) === "undefined" ? undefined
                                              : cidr_default_str.split(","));

var url = "http://" + k8s_host + "/api/v1/services";
var conf_tmpl =
    hogan.compile(fs.readFileSync(path.resolve(__dirname) +
                                  '/nginx.conf.mustache').toString());

var last_update_ts = "";
var last_update_res = "";
var last_update_cfg = "";

var app = express();
app.get('/', function(req, res) {
  var ctx = {
    'k8s_host' : k8s_host,
    'prefix' : prefix,
    'interval' : interval,
    'mgr_port' : mgr_port,
    'url' : url,
    'last_update_ts' : last_update_ts,
    'last_update_res' : last_update_res,
    'last_update_cfg' : last_update_cfg
  };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(ctx));
});

var server = app.listen(mgr_port);

function svc_cmp(a, b) {
  if (a.svc > b.svc)
    return -1;
  if (a.svc > b.svc)
    return 1;
  return 0;
}

function validate(ports, port) {
  for (var i = 0; i < ports.length; i++) {
    if (ports[i].port == port) {
      return {'valid' : true};
    }
  };
  return {'valid' : false, 'error' : 'port not found'};
}

function genConfig(config) {
  var serviceList = JSON.parse(config);

  var pathProxies = [];
  var hostProxies = [];

  serviceList.items.forEach(function(item) {
    if (item.metadata && item.metadata.annotations) {
      Object.keys(item.metadata.annotations)
          .forEach(function(key) {
            if (key.slice(0, prefix.length) === prefix) {
              var svc = item.metadata.name;
              var ip = item.spec.clusterIP;
              var port = key.slice(prefix.length);
              var r = item.metadata.annotations[key];
              var type = r.slice(0, r.indexOf(":"));
              var rule = r.slice(r.indexOf(":") + 1);
              var err = (err_prefix + port) in item.metadata.annotations
                            ? item.metadata.annotations[err_prefix + port]
                            : true;
              var cidr =
                  (cidr_prefix + port) in item.metadata.annotations
                      ? item.metadata.annotations[cidr_prefix + port].split(",")
                      : cidr_default;
              var exposed_port =
                  (exposed_host_port_prefix + port) in item.metadata.annotations
                      ? item.metadata
                            .annotations[exposed_host_port_prefix + port]
                      : default_host_port;

              var v = validate(item.spec.ports, port);
              if (v.valid) {
                var def = {
                  'service' : svc,
                  'rule' : rule,
                  'ip' : ip,
                  'port' : port,
                  'err' : err,
                  'cidr' : cidr,
                  'exposed_port' : exposed_port
                };
                if (type == PATH_RULE) {
                  pathProxies.push(def);
                } else if (type == HOST_RULE) {
                  hostProxies.push(def);
                } else {
                  console.error(
                      'Invalid rule type (%s) when defining service %s and port %s',
                      type, svc, port);
                }
              } else {
                console.error(
                    'Error defining proxy for service %s and port %s: %s', svc,
                    port, v.error);
              }
            }
          });
    }
  });

  pathProxies.push({
    'service' : 'svc_gw',
    'rule' : '/svc_gw/',
    'ip' : 'localhost',
    'port' : mgr_port,
    'err' : true,
    'cidr' : cidr_default
  });

  pathProxies.sort(svc_cmp);
  hostProxies.sort(svc_cmp);

  return conf_tmpl.render({
    'path_proxies' : pathProxies,
    'host_proxies' : hostProxies,
    'exposed_path_port' : exposed_path_port
  });
}

function checkConfig(serviceJson) {
  var new_cfg = genConfig(serviceJson);
  var cur_cfg = fs.readFileSync('/etc/nginx/conf.d/default.conf');

  last_update_cfg = new_cfg;
  ;

  if (new_cfg == cur_cfg) {
    last_update_ts = new Date();
    last_update_res = "No update";
    return;
  }

  fs.writeFile('/etc/nginx/conf.d/default.conf', new_cfg, function(err) {
    last_update_ts = new Date();

    if (err) {
      console.error("Error writing to file %s: %s", destination, err);
      last_update_res = "Error writing config to disk: " + err;
    } else {
      exec('/usr/bin/sv hup nginx', function(err, stdout, stderr) {
        if (err) {
          last_update_res = "Error reloading nginx conf: " + err;
          console.error(last_update_res);
        } else {
          last_update_res = "Success";
        }
      });
    }
  });
}

function update() {
  http.get(url, function(response) {
    if (response.statusCode != 200) {
      last_update_ts = new Date();
      last_update_res =
          "Error making request to " + url + ": " + response.statusCode;
      console.error("Error making request to %s: %s", url, response.statusCode);
      last_update_cfg = "";
    } else {
      var body = '';
      response.on('data', function(d) { body += d; });
      response.on('end', function() { checkConfig(body); });
    }
  });
}

update();

setInterval(update, interval * 1000);
