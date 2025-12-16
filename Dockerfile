# 1. Базовий образ Node.js
FROM node:20

# 2. Робоча директорія всередині контейнера
WORKDIR /app

# 3. Копіюємо package.json і package-lock.json
COPY package*.json ./

# 4. Встановлюємо залежності
RUN npm install

# 5. Копіюємо весь проєкт
COPY . .

# 6. Виставляємо порт
EXPOSE 3000

# 7. Запуск через nodemon
CMD ["npm", "run", "dev"]
