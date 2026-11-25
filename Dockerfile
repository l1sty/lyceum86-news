FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bot.py panel.py valentines.py editor.html student.html ./
COPY editor_assets ./editor_assets
COPY game ./game
COPY mafia/rules.py mafia/web.py ./mafia/
COPY mafia/dist ./mafia/dist
COPY mafia/art ./mafia/art
ENV PORT=8080
EXPOSE 8080
CMD ["python", "-u", "bot.py"]
