import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import express from "express";
import { LRUCache } from "lru-cache";
import PQueue from "p-queue";
import * as fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_HOST = process.env.APP_URL; // Use AI Studio APP_URL
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@Xorazm_ish_bozor1";
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : undefined;
const PORT = 3000; // AI Studio requires port 3000

const subCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 }); // 5 minutes cache
const messageQueue = new PQueue({ concurrency: 50 }); // Process up to 50 messages concurrently

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
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    
    await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('hdp_link', 'https://forms.gle/f6ZiQtiqCAH1CLy87')`);
    await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('omon_link', 'https://forms.gle/97m9hCsBFovYKKrX7')`);
    await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('channel_username', '${CHANNEL_USERNAME}')`);
    
    // Auto-update to new channel if old one is still used
    await db.run(`UPDATE settings SET value = '@Xorazm_ish_bozor1' WHERE key = 'channel_username' AND value = '@dilmurodbekmatematika'`);
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
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
      
      await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('hdp_link', 'https://forms.gle/f6ZiQtiqCAH1CLy87')`);
      await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('omon_link', 'https://forms.gle/97m9hCsBFovYKKrX7')`);
      await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('channel_username', '${CHANNEL_USERNAME}')`);
    } else {
      throw err;
    }
  }
}

// ================= HELPERS =================
async function getSetting(key: string) {
  const row = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
}

async function setSetting(key: string, value: string) {
  await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

const adminState = new Map<number, string>();

async function checkSubscription(ctx) {
  const userId = ctx.from.id;
  if (subCache.has(userId)) {
    return subCache.get(userId);
  }

  try {
    const channel = await getSetting('channel_username');
    const member = await ctx.telegram.getChatMember(
      channel,
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

async function subscriptionKeyboard() {
  const channel = await getSetting('channel_username');
  const channelUrl = channel.startsWith('@') ? `https://t.me/${channel.replace(/^@/,"")}` : channel;
  return Markup.inlineKeyboard([
    [
      Markup.button.url("Obuna bo'lish", channelUrl),
    ],
    [Markup.button.callback("Tekshirish", "check_sub")],
  ]);
}

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "HDP LC" }, { text: "Omon School" }]
      ],
      resize_keyboard: true,
      is_persistent: true
    }
  };
}

// ================= HANDLERS =================
if (bot) {
  // Queue middleware to prevent bot unresponsiveness under high load
  bot.use(async (ctx, next) => {
    return messageQueue.add(async () => {
      try {
        await next();
      } catch (err) {
        console.error("Error processing update:", err);
      }
    });
  });

  bot.start(async (ctx) => {
    const userId = ctx.from.id;

    await db.run(`INSERT OR IGNORE INTO users (user_id) VALUES (?)`, [userId]);

    const subscribed = await checkSubscription(ctx);

    if (!subscribed) {
      return ctx.reply("Botdan foydalanish uchun kanalga obuna bo‘ling:", await subscriptionKeyboard());
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
      return ctx.reply("Avval kanalga obuna bo‘ling:", await subscriptionKeyboard());
    }

    await db.run(`UPDATE users SET hdp = hdp + 1 WHERE user_id = ?`, [ctx.from.id]);
    const hdpLink = await getSetting('hdp_link');

    return ctx.reply("HDP LC uchun forma:", Markup.inlineKeyboard([
      [Markup.button.url("Formani ochish", hdpLink)],
    ]));
  });

  bot.hears("Omon School", async (ctx) => {
    const subscribed = await checkSubscription(ctx);
    if (!subscribed) {
      return ctx.reply("Avval kanalga obuna bo‘ling:", await subscriptionKeyboard());
    }

    await db.run(`UPDATE users SET omon = omon + 1 WHERE user_id = ?`, [ctx.from.id]);
    const omonLink = await getSetting('omon_link');

    return ctx.reply("Omon School uchun forma:", Markup.inlineKeyboard([
      [Markup.button.url("Formani ochish", omonLink)],
    ]));
  });

  bot.command("myid", (ctx) => {
    ctx.reply(`Sizning Telegram ID raqamingiz: <code>${ctx.from.id}</code>\n\nShu raqamni nusxalab, AI Studio'dagi "Secrets" (yoki Environment Variables) bo'limiga <b>ADMIN_ID</b> nomi bilan qo'shing. Shundan so'ng botni qayta ishga tushirsangiz /admin buyrug'i ishlaydi.`, { parse_mode: "HTML" });
  });

  bot.command("admin", async (ctx) => {
    if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) return;

    const usersRow = await db.get(`SELECT COUNT(*) as total FROM users`);
    const clicksRow = await db.get(`SELECT SUM(hdp) as total_hdp, SUM(omon) as total_omon FROM users`);
    const totalUsers = usersRow?.total || 0;
    const total_hdp = clicksRow?.total_hdp || 0;
    const total_omon = clicksRow?.total_omon || 0;

    const hdpLink = await getSetting('hdp_link');
    const omonLink = await getSetting('omon_link');
    const channel = await getSetting('channel_username');

    const text = `📊 Statistika:\n\n👥 Foydalanuvchilar: ${totalUsers}\n\n🔹 HDP LC bosilgan: ${total_hdp}\n🔹 Omon School bosilgan: ${total_omon}\n\n⚙️ <b>Joriy sozlamalar:</b>\nKanal: ${channel}\nHDP Link: ${hdpLink}\nOmon Link: ${omonLink}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("✏️ Kanalni o'zgartirish", "edit_channel")],
      [Markup.button.callback("✏️ HDP silkani o'zgartirish", "edit_hdp")],
      [Markup.button.callback("✏️ Omon silkani o'zgartirish", "edit_omon")],
      [Markup.button.callback("📢 Xabar tarqatish", "broadcast_msg")],
      [Markup.button.callback("❌ Bekor qilish", "cancel_admin")]
    ]);

    ctx.reply(text, { parse_mode: "HTML", ...keyboard });
  });

  bot.action("edit_channel", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState.set(ctx.from.id, "awaiting_channel");
    ctx.reply("Yangi kanal username'ini yuboring (masalan: @yangi_kanal):");
    ctx.answerCbQuery();
  });

  bot.action("edit_hdp", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState.set(ctx.from.id, "awaiting_hdp");
    ctx.reply("Yangi HDP LC silkasini yuboring (https://...):");
    ctx.answerCbQuery();
  });

  bot.action("edit_omon", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState.set(ctx.from.id, "awaiting_omon");
    ctx.reply("Yangi Omon School silkasini yuboring (https://...):");
    ctx.answerCbQuery();
  });

  bot.action("broadcast_msg", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState.set(ctx.from.id, "awaiting_broadcast");
    ctx.reply("Tarqatmoqchi bo'lgan xabaringizni yuboring (Matn, rasm, video va h.k):");
    ctx.answerCbQuery();
  });

  bot.action("cancel_admin", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState.delete(ctx.from.id);
    ctx.deleteMessage().catch(() => {});
    ctx.answerCbQuery("Bekor qilindi");
  });

  bot.on("message", async (ctx, next) => {
    const userId = ctx.from.id;
    if (userId === ADMIN_ID && adminState.has(userId)) {
      const state = adminState.get(userId);

      if (state === "awaiting_broadcast") {
        adminState.delete(userId);
        ctx.reply("Xabar tarqatish boshlandi. Bu biroz vaqt olishi mumkin...");
        
        const users = await db.all(`SELECT user_id FROM users`);
        let successCount = 0;
        let failCount = 0;

        // Xabarlarni orqa fonda tarqatish (Queue orqali)
        (async () => {
          for (const user of users) {
            await messageQueue.add(async () => {
              try {
                await ctx.copyMessage(user.user_id);
                successCount++;
              } catch (err) {
                failCount++;
              }
            });
          }
          await ctx.reply(`✅ Xabar tarqatish yakunlandi!\n\nYetkazildi: ${successCount} ta\nXatolik/Bloklaganlar: ${failCount} ta`);
        })();
        return;
      }

      const msg = ctx.message as any;
      if (!msg.text) {
        ctx.reply("Iltimos, faqat matn yuboring.");
        return;
      }
      const text = msg.text;

      if (state === "awaiting_channel") {
        await setSetting('channel_username', text);
        ctx.reply("✅ Kanal muvaffaqiyatli o'zgartirildi!");
      } else if (state === "awaiting_hdp") {
        await setSetting('hdp_link', text);
        ctx.reply("✅ HDP LC silkasi o'zgartirildi!");
      } else if (state === "awaiting_omon") {
        await setSetting('omon_link', text);
        ctx.reply("✅ Omon School silkasi o'zgartirildi!");
      }
      adminState.delete(userId);
      return;
    }
    return next();
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
