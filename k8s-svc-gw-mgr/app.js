#!/usr/bin/env node

var exec    = require('child_process').exec;
var express = require('express');
var fs      = require('fs');
var hogan   = require('hogan.js');
var http    = require('http');
var path    = require('path');
var program = require('commander');

var PATH_RULE = "path";
var HOST_RULE = "host";

program
  .version('1.0.0')
  .option('-h, --host [host]',     'Kubernetes host to query. Env var $SVC_GW_K8S_API_HOST. Defaults to $KUBERNETES_RO_SERVICE_HOST.')
  .option('-p, --prefix [prefix]', 'Annotation prefix to use. Env var $SVC_GW_PREFIX. Default is "svcproxy."')
  .option('-i, --interval [val]',  'Interval on which to poll for new or removed services in seconds. Env var $SVC_GW_INTERVAL. Defaults to 60.')
  .option('-l, --listen [val]',    'Port on which built-in web interface should listen. Env var SVC_GW_MGR_PORT. Defaults to 9090.')
  .parse(process.argv);


var k8s_host  = program.host     || process.env.SVC_GW_K8S_API_HOST || process.env.KUBERNETES_RO_SERVICE_HOST;
var prefix    = program.prefix   || process.env.SVC_GW_PREFIX       || "svcgateway.";
var interval  = program.interval || process.env.SVC_GW_INTERVAL     || 60;
var mgr_port  = program.listen   || process.env.SVC_GW_MGR_PORT     || 9090;

var url       = "http://" + k8s_host + "/api/v1beta3/services";
var conf_tmpl = hogan.compile(fs.readFileSync(path.resolve(__dirname) + '/nginx.conf.mustache').toString());

var last_update_ts   = "";
var last_update_res  = "";
var last_update_cfg  = "";


var app = express();
app.get('/', function(req, res) {
  var ctx = {
    'k8s_host': k8s_host,
    'prefix': prefix,
    'interval': interval,
    'mgr_port': mgr_port,
    'url': url,
    'last_update_ts': last_update_ts,
    'last_update_res': last_update_res,
    'last_update_cfg': last_update_cfg
  };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(ctx));
});

var server = app.listen(mgr_port);


function svc_cmp(a, b) {
  if (a.svc > b.svc)
    return -1;
  if (a.svc > b.svc)
    return 1
  return 0;
}


function validate( ports, port ) {
  for (var i = 0; i < ports.length; i++) {
    if ( ports[i].port == port ) {
      return { 'valid': true };
    } 
  };
  return { 'valid': false, 'error': 'port not found' };
} 


function genConfig(config) {
  var serviceList = JSON.parse(config);

  var pathProxies = [];
  var hostProxies = [];

  serviceList.items.forEach( function( item ) {
    if ( item.metadata && item.metadata.annotations ) {
      Object.keys( item.metadata.annotations ).forEach( function( key ) {
        if ( key.slice(0, prefix.length) === prefix ) { 
          var svc = item.metadata.name;
          var ip = item.spec.portalIP;
          var port = key.slice(prefix.length);
          var r = item.metadata.annotations[key];
          var type = r.slice(0, r.indexOf(":"));
          var rule = r.slice(r.indexOf(":")+1);


          var v = validate( item.spec.ports, port );
          if (v.valid) {
            var def = { 'service': svc, 'rule': rule, 'ip': ip, 'port': port };
            if ( type == PATH_RULE ) {
              pathProxies.push( def );
            } else if ( type == HOST_RULE ) {
              hostProxies.push( def );
            } else {
              console.error('Invalid rule type (%s) when defining service %s and port %s', type, svc, port); 
            }
          } else {
            console.error('Error defining proxy for service %s and port %s: %s', svc, port, v.error);
          } 
        } 
      });
    } 
  });

  pathProxies.push( { 'service': 'svc_gw', 'rule': '/svc_gw/', 'ip': 'localhost', 'port': mgr_port } );

  pathProxies.sort(svc_cmp);
  hostProxies.sort(svc_cmp);

  return conf_tmpl.render({ 'path_proxies': pathProxies, 'host_proxies': hostProxies });
}


function checkConfig(serviceJson) {
  var new_cfg = genConfig(serviceJson);
  var cur_cfg = fs.readFileSync('/etc/nginx/conf.d/default.conf');

  last_update_cfg = new_cfg;;

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
      last_update_res = "Error making request to " + url + ": " + response.statusCode;
      console.error("Error making request to %s: %s", URL, response.statusCode);
      last_update_cfg = "";
    } else {
      var body = '';
      response.on('data', function(d) { body += d;         });
      response.on('end',  function()  { checkConfig(body); });
    }
  });
}

update();

setInterval( update, interval * 1000 );
