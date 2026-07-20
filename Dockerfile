FROM mlikiowa/napcat-docker:latest
WORKDIR /app
COPY NapCat.Shell.zip /tmp/NapCat.Shell.zip
RUN apt-get update && apt-get install -y --fix-broken x11vnc && rm -rf /var/lib/apt/lists/*
RUN rm -rf /app/napcat && mkdir -p /app/napcat && \
    unzip -q /tmp/NapCat.Shell.zip -d /tmp/NapCat.Shell && \
    cp -rf /tmp/NapCat.Shell/* /app/napcat/ && \
    rm -rf /tmp/NapCat.Shell /tmp/NapCat.Shell.zip
