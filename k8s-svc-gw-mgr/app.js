#!/usr/bin/env node

var exec = require('child_process').exec;
var express = require('express');
var fs = require('fs');
var hogan = require('hogan.js');
var https = require('https');
var url = require('url');
var path = require('path');
var program = require('commander');

var PATH_RULE = "path";
var HOST_RULE = "host";

program.version('1.0.0')
    .option(
         '-h, --host [host]',
         'Kubernetes host to query. Env var $SVC_GW_K8S_API_HOST. Defaults to $KUBERNETES_SERVICE_HOST.')
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
         '-W, --websocket-enabled [websocket]',
         'Annotation websocket enabled prefix to use. Env var $SVC_GW_SSL_PREFIX. Default is "websocket."')
    .option(
         '-S, --ssl-enabled [ssl]',
         'Annotation SSL enabled prefix to use. Env var $SVC_GW_SSL_PREFIX. Default is "ssl."')
    .option(
         '-R, --ssl-redirect [ssl_redirect]',
         'Annotation SSL redirect prefix to use. Env var $SVC_GW_SSL_PREFIX. Default is "ssl.redirect."')
    .option(
         '-C, --ssl-cert [ssl_cert]',
         'Annotation SSL cert prefix to use. Env var $SVC_GW_SSL_CERT_PREFIX. Default is "path.ssl.cert."')
    .option(
         '-D, --default-ssl-cert-path [default_ssl_cert_path]',
         'Default SSL cert path to use if specified. Env var $SVC_GW_SSL_CERT_DEFAULT. Defaults to "/etc/secrets/cert.crt".')
    .option(
         '-k, --ssl-key [ssl_key]',
         'Annotation SSL key prefix to use. Env var $SVC_GW_SSL_KEY_PREFIX. Default is "path.ssl.key."')
    .option(
         '-K, --default-ssl-key-path [default_ssl_key_path]',
         'Default SSL key path to use if specified. Env var $SVC_GW_SSL_KEY_DEFAULT. Defaults to "/etc/secrets/key.pem".')
    .option(
         '-h, --ssl-dhparam [dhparam]',
         'Annotation SSL dhparam prefix to use. Env var $SVC_GW_SSL_DHPARAM_PREFIX. Default is "path.ssl.dhparam."')
    .option(
         '-H, --default-ssl-dhparam-path [default_ssl_dhparam_path]',
         'Default SSL dhparam path to use if specified. Env var $SVC_GW_DHPARAM_KEY_DEFAULT. Defaults to "/etc/secrets/dhparam".')
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
               process.env.KUBERNETES_SERVICE_HOST;
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
var websocket_prefix = program.websocket || process.env.SVC_GW_WEBSOCKET_PREFIX || "websocket.";
var ssl_prefix = program.ssl || process.env.SVC_GW_SSL_PREFIX || "ssl.";
var ssl_redirect_prefix = program.ssl_redirect || process.env.SVC_GW_SSL_REDIRECT_PREFIX || "ssl.redirect.";
var ssl_cert_prefix = program.ssl_cert || process.env.SVC_GW_SSL_CERT_PREFIX || "path.ssl.cert.";
var default_ssl_cert_path =
    program.default_ssl_cert_path || process.env.SVC_GW_DEFAULT_SSL_CERT_PATH || "/etc/secrets/cert.crt";
var ssl_key_prefix = program.ssl_key || process.env.SVC_GW_SSL_KEY_PREFIX || "path.ssl.key.";
var default_ssl_key_path =
    program.default_ssl_key_path || process.env.SVC_GW_DEFAULT_SSL_KEY_PATH || "/etc/secrets/key.pem";
var ssl_dhparam_prefix = program.ssl_dhparam || process.env.SVC_GW_SSL_DHPARM_PREFIX || "path.ssl.dhparam.";
var default_ssl_dhparam_path =
    program.default_ssl_dhparam_path || process.env.SVC_GW_DEFAULT_SSL_DHPARAM_PATH || "/etc/secrets/dhparam";

var cidr_default =
    (typeof(cidr_default_str) === "undefined" ? undefined
                                              : cidr_default_str.split(","));

var root_url = "https://" + k8s_host + "/api/v1/services";
var k8s_token = fs.readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token").toString();
var k8s_ca_cert = fs.readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt").toString();
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
    'url' : root_url,
    'last_update_ts' : last_update_ts,
    'last_update_res' : last_update_res,
    'last_update_cfg' : last_update_cfg
  };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(ctx));
});

var server = app.listen(mgr_port);

function svc_cmp(a, b) {
  if (a.svc < b.svc)
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
              var ssl = item.metadata.annotations[ssl_prefix + port] === "true" ?
                            true : undefined;
              var ssl_redirect = item.metadata.annotations[ssl_redirect_prefix + port] === "true" ?
                            true : undefined;
              var ssl_cert = (ssl_cert_prefix + port) in item.metadata.annotations
                            ? item.metadata.annotations[ssl_cert_prefix + port]
                            : default_ssl_cert_path;
              var ssl_cert_key = (ssl_key_prefix + port) in item.metadata.annotations
                            ? item.metadata.annotations[ssl_key_prefix + port]
                            : default_ssl_key_path;
              var ssl_dhparam = (ssl_dhparam_prefix + port) in item.metadata.annotations
                            ? item.metadata.annotations[ssl_dhparam_prefix + port]
                            : default_ssl_dhparam_path;
              var websocket = item.metadata.annotations[websocket_prefix + port] === "true" ?
                            true : undefined;


              var v = validate(item.spec.ports, port);
              if (v.valid) {
                var def = {
                  'service' : svc,
                  'rule' : rule,
                  'ip' : ip,
                  'port' : port,
                  'err' : err,
                  'cidr' : cidr,
                  'exposed_port' : exposed_port,
                  'ssl': ssl,
                  'ssl_redirect': ssl_redirect,
                  'ssl_cert': ssl_cert,
                  'ssl_cert_key': ssl_cert_key,
                  'ssl_dhparam': ssl_dhparam,
                  'websocket': websocket
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
  var req_obj = url.parse(root_url);
  req_obj.headers = {
    "Authorization": "Bearer " + k8s_token
  };

  req_obj.ca = k8s_ca_cert;

  https.get(req_obj, function(response) {
    if (response.statusCode != 200) {
      last_update_ts = new Date();
      last_update_res =
          "Error making request to " + root_url + ": " + response.statusCode;
      console.error("Error making request to %s: %s", root_url, response.statusCode);
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
