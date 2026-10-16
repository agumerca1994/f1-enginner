# Static landing page, served by nginx.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html instructivos.html favicon.ico /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
