FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bot.py panel.py editor.html student.html ./
COPY game ./game
ENV PORT=8080
EXPOSE 8080
CMD ["python", "-u", "bot.py"]
