# INSTALL nginx
NGINX_VERSION=1.8.0-1~trusty

apt-key adv --keyserver hkp://pgp.mit.edu:80 --recv-keys 573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62
#echo "deb http://nginx.org/packages/ubuntu/ lucid nginx" >> /etc/apt/sources.list
add-apt-repository "deb http://nginx.org/packages/ubuntu $(lsb_release -sc) nginx"
add-apt-repository "deb http://archive.ubuntu.com/ubuntu $(lsb_release -sc) main universe"
apt-get update
apt-get install -y ca-certificates nginx=${NGINX_VERSION} 

# INSTALL node
apt-get install -y build-essential python
cd /tmp 
curl -O http://nodejs.org/dist/node-latest.tar.gz 
tar xvzf node-latest.tar.gz 
rm -f node-latest.tar.gz 
cd node-v* 
./configure 
CXX="g++ -Wno-unused-local-typedefs" make 
CXX="g++ -Wno-unused-local-typedefs" make install 
cd /tmp 
rm -rf /tmp/node-v* 
npm install -g npm 
printf '\n# Node.js\nexport PATH="node_modules/.bin:$PATH"' >> /root/.bashrc

apt-get purge -y --auto-remove build-essential
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
