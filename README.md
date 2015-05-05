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
        "svcgateway.80": "host:fe.example.com"
      }
   },
   "spec":{
      "ports": [
        {
          "port":80,
          "targetPort":80,
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
    listen       80;
    server_name  fe.example.com;

    # front-end proxy
    location / {
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_pass http://{{ip}}:{{port}}/;
    }

    # redirect server error pages to the static page /50x.html
    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }
}
```

Alternatively, path based proxies can be created as well by prefixing the value of the annotation with the string "path:" and then the rule to be applied.

The service gateway checks for updates every minute, though that's configurable through env vars, as are several other things:

| ENV Var             | Description
| ------------------- | -----------
| SVC_GW_K8S_API_HOST | which kubernetes API to connect to. Defaults to $KUBERNETES_RO_SERVICE_HOST.
| SVC_GW_PREFIX       | which annotation prefix to look for. Defaults to 'svcgateway'.
| SVC_GW_INTERVAL     | interval in seconds on which to pull service list. Defaults to 60.
| SVC_GW_MGR_PORT     | port the mgr app listens on. Defaults to 9090.

To deploy this (only just barely tested in GKE), you would use a ReplicationController definition something like this:

```json
{
   "kind":"ReplicationController",
   "apiVersion":"v1beta3",
   "metadata":{
      "name":"k8s-svc-gw",
      "labels":{
         "name":"k8s-svc-gw",
         "version": "0.0.0"
      }
   },
   "spec":{
      "replicas":3,
      "selector":{
         "name":"k8s-svc-gw"
      },
      "template":{
         "metadata":{
            "labels":{
               "name":"k8s-svc-gw"
            }
         },
         "spec":{
            "containers":[
               {
                  "name":"k8s-svc-gw",
                  "image":"joelpm/k8s-svc-gw:0.0.0",
                  "ports":[
                     {
                        "containerPort": 80,
                        "protocol": "TCP"
                     }
                  ]
               }
            ]
         }
      }
   }
}
```

And a service definition like:

```json
{
   "kind":"Service",
   "apiVersion":"v1beta3",
   "metadata":{
      "name":"k8s-svc-gw",
      "labels":{
         "name":"k8s-svc-gw"
      }
   },
   "spec":{
      "ports": [
        {
          "port":80,
          "targetPort":80,
          "protocol":"TCP"
        }
      ],
      "selector":{
         "name":"k8s-svc-gw"
      },
      "createExternalLoadBalancer": true
   }
}
```
