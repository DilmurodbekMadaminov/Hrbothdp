import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import express from "express";
import { LRUCache } from "lru-cache";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_HOST = process.env.APP_URL; // Use AI Studio APP_URL
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@dilmurodbekmatematika";
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : undefined;
const PORT = 3000; // AI Studio requires port 3000

const subCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 }); // 5 minutes cache

if (!BOT_TOKEN) {
  console.error("Missing required environment variable: BOT_TOKEN.\nPlease configure it in the AI Studio Secrets panel.");
}

const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;
const app = express();

// ================= DATABASE =================
let db: any;
async function initDb() {
  const dbPath = './data/database.db';
  try {
    if (!fs.existsSync('./data')) {
      fs.mkdirSync('./data', { recursive: true });
    }
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        hdp INTEGER DEFAULT 0,
        omon INTEGER DEFAULT 0
      )
    `);
  } catch (err: any) {
    if (err.message.includes('SQLITE_CORRUPT') || err.message.includes('malformed')) {
      console.error("Database corrupt, recreating...");
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          user_id INTEGER PRIMARY KEY,
          hdp INTEGER DEFAULT 0,
          omon INTEGER DEFAULT 0
        )
      `);
    } else {
      throw err;
    }
  }
}

// ================= HELPERS =================
async function checkSubscription(ctx) {
  const userId = ctx.from.id;
  if (subCache.has(userId)) {
    return subCache.get(userId);
  }

  try {
    const member = await ctx.telegram.getChatMember(
      CHANNEL_USERNAME,
      userId
    );

    const isSubscribed = (
      member.status === "member" ||
      member.status === "creator" ||
      member.status === "administrator"
    );
    
    subCache.set(userId, isSubscribed);
    return isSubscribed;
  } catch (err) {
    console.error("Subscription check error:", err.message);
    return false;
  }
}

function subscriptionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.url("Obuna bo'lish", `https://t.me/${CHANNEL_USERNAME.replace(/^@/,"")}`),
    ],
    [Markup.button.callback("Tekshirish", "check_sub")],
  ]);
}

function mainMenuKeyboard() {
  return Markup.keyboard(["HDP LC", "Omon School"]).resize().oneTime(false);
}

// ================= HANDLERS =================
if (bot) {
  bot.start(async (ctx) => {
    const userId = ctx.from.id;

    await db.run(`INSERT OR IGNORE INTO users (user_id) VALUES (?)`, [userId]);

    const subscribed = await checkSubscription(ctx);

    if (!subscribed) {
      return ctx.reply("Botdan foydalanish uchun kanalga obuna bo‘ling:", subscriptionKeyboard());
    }

    return ctx.reply("Ish joyini tanlang:", mainMenuKeyboard());
  });

  bot.action("check_sub", async (ctx) => {
    const subscribed = await checkSubscription(ctx);

    if (!subscribed) {
      return ctx.answerCbQuery("Siz hali obuna bo‘lmagansiz!", { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {});
    return ctx.reply("Ish joyini tanlang:", mainMenuKeyboard());
  });

  bot.hears("HDP LC", async (ctx) => {
    const subscribed = await checkSubscription(ctx);
    if (!subscribed) {
      return ctx.reply("Avval kanalga obuna bo‘ling:", subscriptionKeyboard());
    }

    await db.run(`UPDATE users SET hdp = hdp + 1 WHERE user_id = ?`, [ctx.from.id]);

    return ctx.reply("HDP LC uchun forma:", Markup.inlineKeyboard([
      [Markup.button.url("Formani ochish", "https://forms.gle/f6ZiQtiqCAH1CLy87")],
    ]));
  });

  bot.hears("Omon School", async (ctx) => {
    const subscribed = await checkSubscription(ctx);
    if (!subscribed) {
      return ctx.reply("Avval kanalga obuna bo‘ling:", subscriptionKeyboard());
    }

    await db.run(`UPDATE users SET omon = omon + 1 WHERE user_id = ?`, [ctx.from.id]);

    return ctx.reply("Omon School uchun forma:", Markup.inlineKeyboard([
      [Markup.button.url("Formani ochish", "https://forms.gle/97m9hCsBFovYKKrX7")],
    ]));
  });

  bot.command("admin", async (ctx) => {
    if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) return;

    const usersRow = await db.get(`SELECT COUNT(*) as total FROM users`);
    const clicksRow = await db.get(`SELECT SUM(hdp) as total_hdp, SUM(omon) as total_omon FROM users`);

    ctx.reply(`📊 Statistika:\n\n👥 Foydalanuvchilar: ${usersRow.total || 0}\n\n🔹 HDP LC bosilgan: ${clicksRow.total_hdp || 0}\n🔹 Omon School bosilgan: ${clicksRow.total_omon || 0}`);
  });
}

// ================= WEBHOOK & SERVER START =================
async function start() {
  await initDb();
  
  // Basic route to show bot status in the AI Studio preview
  app.get('/', (req, res) => {
    if (!BOT_TOKEN) {
      res.send("<h1>Bot Error</h1><p>BOT_TOKEN is missing. Please add it to the Secrets panel.</p>");
    } else {
      res.send("<h1>Bot is Running</h1><p>The Telegram bot is active.</p>");
    }
  });

  // start express first so health checks pass
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  if (bot) {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.WEBHOOK_DOMAIN;
    
    if (domain) {
      try {
        const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
        app.use(bot.webhookCallback(webhookPath));
        await bot.telegram.setWebhook(`https://${domain}${webhookPath}`);
        console.log(`Bot launched using webhook on ${domain}`);
      } catch (err: any) {
        console.error("Failed to set webhook:", err.message);
      }
    } else {
      try {
        // Telegram webhooklari ba'zan dev muhitida ishlamaydi, shuning uchun long polling ishlatamiz
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        
        // Start long polling without blocking
        bot.launch().then(() => {
          console.log('Bot launched using long polling.');
        }).catch((err: any) => {
          if (err.message.includes('409: Conflict')) {
            console.error("⚠️ XATOLIK: Bot ayni paytda boshqa joyda (masalan, AI Studio'da) ishlab turibdi.");
            console.error("⚠️ Telegram faqat bitta serverga ulanishga ruxsat beradi. Railway'da ishlashi uchun AI Studio'ni yoping yoki Railway'da domenni yoqing.");
          } else {
            console.error("Failed to launch bot:", err.message);
          }
        });
      } catch (err: any) {
        console.error("Failed to delete webhook:", err.message);
      }
    }
  }

  // graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => {
      db.close(() => process.exit(0));
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start();
