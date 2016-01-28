# k8s-svc-gw
A kubernetes service gateway docker container.



I'm sure there are _much_ better (and secure) ways of achieving this. For now it's just a nodejs app that queries the k8s api server to get a list of services. For those that are annotated appropriately, an nginx reverse proxy rule is created. For example, the following service:

```json
{
   "kind":"Service",
   "apiVersion":"v1beta3",
   "metadata":{
      "name":"front-end",
      "labels":{
         "name":"front-end"
      },
      "annotations": {
        "svcgateway.8080": "host:fe.example.com",
        "err.svcgateway.8080": true,
        "cidr.8080": "192.168.0.0/16,192.100.0.0/16",
        "port.svcproxy.8080":"9090",

        "svcgateway.9000": "host:fi.example.com",
        "err.svcgateway.9000": false,
        "cidr.9000": "10.20.0.0/16,10.21.0.0/16",
        "port.svcproxy.9000":"5678"
      }
   },
   "spec":{
      "ports": [
        {
          "port":8080,
          "targetPort":80,
          "protocol":"TCP"
        },
        {
          "port":9000,
          "targetPort":2222,
          "protocol":"TCP"
        }
      ],
      "selector":{
         "name":"front-end"
      }
   }
}
```

Would result in the following nginx server being created:

```
server {
    listen       9090;
    server_name  fe.example.com;

    # front-end proxy
    location / {
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_pass http://{{ip}}:8080/;

      allow 192.168.0.0/16;
      allow 192.100.0.0/16;
      deny all;
    }

    # redirect server error pages to the static page /50x.html
    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }
}
server {
    listen       5678;
    server_name  fi.example.com;

    # front-end proxy
    location / {
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_pass http://{{ip}}:9000/;

      allow 10.20.0.0/16;
      allow 10.21.0.0/16
      deny all;
    }
}
```

Alternatively, path based proxies can be created as well by prefixing the value of the annotation with the string "path:" and then the rule to be applied.

The service gateway checks for updates every minute, though that's configurable through env vars, as are several other things:

| ENV Var                           | Description
| --------------------------------- | -----------
| SVC_GW_K8S_API_HOST               | which kubernetes API to connect to. Defaults to $KUBERNETES_RO_SERVICE_HOST.
| SVC_GW_PREFIX                     | which annotation prefix to look for. Defaults to 'svcgateway'.
| SVC_GW_ERR_PREFIX                 | which annotation prefix to look for if error capturing should take effect. Default is "err.svcproxy."
| SVC_GW_CIDR                       | which annotation prefix to look for cidr block whitelisting. Default is "cidr."
| SVC_GW_CIDR_DEFAULT               | environmental variable setting default cidr block whitelisting, comma separated list
| SVC_GW_WEBSOCKET_PREFIX           | which annotation prefix to look for enabling websockets. Default is "websocket.". Set annotation value to "true" to enable.
| SVC_GW_SSL_PREFIX                 | which annotation prefix to look for enabling SSL. Default is "ssl.". Set annotation value to "true" to enable.
| SVC_GW_SSL_REDIRECT_PREFIX        | which annotation prefix to look for enabling HTTP to HTTPS redirection. Default is "ssl.redirect.". Set annotation value to "true" to enable.
| SVC_GW_SSL_CERT_PREFIX            | which annotation prefix to look for setting SSL cert path. Default is "path.ssl.cert."
| SVC_GW_DEFAULT_SSL_CERT_PATH      | default path to SSL cert for this host. Defaults to "etc/secrets/cert.crt".
| SVC_GW_SSL_KEY_PREFIX             | which annotation prefix to look for setting SSL cert key path. Default is "path.ssl.cert."
| SVC_GW_DEFAULT_SSL_KEY_PATH       | default path to SSL cert key for this host. Defaults to "etc/secrets/key.pem".
| SVC_GW_SSL_DHPARM_PREFIX          | which annotation prefix to look for setting SSL DH params path. Default is "path.ssl.dhparam."
| SVC_GW_DEFAULT_SSL_DHPARM_PATH    | default path to SSL DH params for this host. Defaults to "etc/secrets/dhparam".
| SVC_GW_INTERVAL                   | interval in seconds on which to pull service list. Defaults to 60.
| SVC_GW_MGR_PORT                   | port the mgr app listens on. Defaults to 9090.
| SVC_GW_EXPOSED_HOST_PORT_PREFIX   | Annotation exposed host port prefix to use. Default is "port.svcproxy."
| SVC_GW_DEFAULT_HOST_PORT          | default port on which host proxy interfaces should listen. Defaults to 80
| SVC_GW_EXPOSED_PATH_PROXY_PORT    | port on which path proxy interface should listen. Defaults to 80

To deploy this (only just barely tested in GKE), you would use a ReplicationController definition something like this:

``` yaml
  kind: ReplicationController
  apiVersion: v1
  metadata:
    name: k8s-svc-gw
    labels:
      name: k8s-svc-gw
  spec:
    replicas: 1
    selector:
      name: k8s-svc-gw
    template:
      metadata:
        labels:
          name: k8s-svc-gw
          version: "0.0.0"
      spec:
        volumes:
          - name: ssl-proxy-secret
            secret:
              secretName: ssl-proxy-secret
        containers:
          - image: joelpm/k8s-svc-gw:0.0.0
            name: k8s-svc-gw
            volumeMounts:
            - name: ssl-proxy-secret
              mountPath: "/etc/secrets"
              readOnly: true
            ports:
              - name: proxy-http
                containerPort: 80
                protocol: TCP
              - name: proxy-https
                containerPort: 443
                protocol: TCP
```

And a service definition like:

``` yaml
apiVersion: v1
kind: Service
metadata:
  labels:
    name: k8s-svc-gw
  name: k8s-svc-gw
spec:
  type: LoadBalancer
  ports:
    - name: http
      port: 80
      targetPort: proxy-http
      protocol: TCP
    - name: https
      port: 443
      targetPort: proxy-https
      protocol: TCP
  selector:
    name: k8s-svc-gw
```

And if using SSL, a [Secrets](http://kubernetes.io/v1.1/docs/user-guide/secrets.html) definition like this:

```yaml
apiVersion: "v1"
kind: "Secret"
metadata:
  name: "ssl-proxy-secret"
  namespace: "default"
data:
  "cert.crt": "..."
  "key.pem": "..."
  dhparam: "..."
```

The data files should be converted into Base-64 using:

```
$ cat cert.crt | base64
```