FROM node:20-alpine

# Ishlash papkasini yaratish
WORKDIR /app

# package.json va package-lock.json fayllarini nusxalash
COPY package*.json ./

# Kutubxonalarni o'rnatish
RUN npm install

# Qolgan barcha kodlarni nusxalash
COPY . .

# 3000 portni ochish
EXPOSE 3000

# Botni ishga tushirish
CMD ["npm", "start"]
