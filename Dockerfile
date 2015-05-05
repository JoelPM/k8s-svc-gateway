# Use phusion/baseimage as base image. To make your builds reproducible, make
# sure you lock down to a specific version, not to `latest`!
# See https://github.com/phusion/baseimage-docker/blob/master/Changelog.md for
# a list of version numbers.
FROM phusion/baseimage:0.9.16

COPY build.sh /tmp/

RUN /tmp/build.sh

# Add the nginx runit script
RUN mkdir /etc/service/nginx
COPY nginx.sh /etc/service/nginx/run

# Add the manager nodejs app
RUN mkdir /opt/svc_gateway_mgr/
COPY svc_gateway_mgr /opt/svc_gateway_mgr/
RUN cd /opt/svc_gateway_mgr && npm install

# Add the runit script for the mgr app
RUN mkdir /etc/service/svc_gateway_mgr
COPY svc_gateway_mgr.sh /etc/service/svc_gateway_mgr/run


EXPOSE 80 443

# Use baseimage-docker's init system.
CMD ["/sbin/my_init"]

# Clean up APT when done.
