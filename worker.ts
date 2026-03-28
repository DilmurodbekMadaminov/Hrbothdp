import { Telegraf, Markup } from "telegraf";

export interface Env {
  BOT_TOKEN: string;
  CHANNEL_USERNAME: string;
  ADMIN_ID: string;
  DB: D1Database;
}

// Simple in-memory cache for the worker isolate
const subCache = new Map<number, { isSubscribed: boolean, expiresAt: number }>();

async function checkSubscription(ctx: any, env: Env) {
  const userId = ctx.from.id;
  const now = Date.now();
  
  const cached = subCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.isSubscribed;
  }

  try {
    const member = await ctx.telegram.getChatMember(
      env.CHANNEL_USERNAME || "@dilmurodbekmatematika",
      userId
    );

    const isSubscribed = (
      member.status === "member" ||
      member.status === "creator" ||
      member.status === "administrator"
    );
    
    subCache.set(userId, { isSubscribed, expiresAt: now + 5 * 60 * 1000 });
    return isSubscribed;
  } catch (err: any) {
    console.error("Subscription check error:", err.message);
    return false;
  }
}

function subscriptionKeyboard(env: Env) {
  const channel = (env.CHANNEL_USERNAME || "@dilmurodbekmatematika").replace(/^@/, "");
  return Markup.inlineKeyboard([
    [Markup.button.url("Obuna bo'lish", `https://t.me/${channel}`)],
    [Markup.button.callback("Tekshirish", "check_sub")],
  ]);
}

function mainMenuKeyboard() {
  return Markup.keyboard(["HDP LC", "Omon School"]).resize().oneTime(false);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "GET") {
      return new Response("Telegram Bot is running on Cloudflare Workers!");
    }

    if (request.method === "POST") {
      const bot = new Telegraf(env.BOT_TOKEN);

      // Initialize DB table
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          user_id INTEGER PRIMARY KEY,
          hdp INTEGER DEFAULT 0,
          omon INTEGER DEFAULT 0
        )
      `).run();

      bot.start(async (ctx) => {
        const userId = ctx.from.id;
        await env.DB.prepare(`INSERT OR IGNORE INTO users (user_id) VALUES (?)`).bind(userId).run();

        const subscribed = await checkSubscription(ctx, env);
        if (!subscribed) {
          return ctx.reply("Botdan foydalanish uchun kanalga obuna bo‘ling:", subscriptionKeyboard(env));
        }
        return ctx.reply("Ish joyini tanlang:", mainMenuKeyboard());
      });

      bot.action("check_sub", async (ctx) => {
        const subscribed = await checkSubscription(ctx, env);
        if (!subscribed) {
          return ctx.answerCbQuery("Siz hali obuna bo‘lmagansiz!", { show_alert: true });
        }
        await ctx.deleteMessage().catch(() => {});
        return ctx.reply("Ish joyini tanlang:", mainMenuKeyboard());
      });

      bot.hears("HDP LC", async (ctx) => {
        const subscribed = await checkSubscription(ctx, env);
        if (!subscribed) {
          return ctx.reply("Avval kanalga obuna bo‘ling:", subscriptionKeyboard(env));
        }
        await env.DB.prepare(`UPDATE users SET hdp = hdp + 1 WHERE user_id = ?`).bind(ctx.from.id).run();
        return ctx.reply("HDP LC uchun forma:", Markup.inlineKeyboard([
          [Markup.button.url("Formani ochish", "https://forms.gle/f6ZiQtiqCAH1CLy87")],
        ]));
      });

      bot.hears("Omon School", async (ctx) => {
        const subscribed = await checkSubscription(ctx, env);
        if (!subscribed) {
          return ctx.reply("Avval kanalga obuna bo‘ling:", subscriptionKeyboard(env));
        }
        await env.DB.prepare(`UPDATE users SET omon = omon + 1 WHERE user_id = ?`).bind(ctx.from.id).run();
        return ctx.reply("Omon School uchun forma:", Markup.inlineKeyboard([
          [Markup.button.url("Formani ochish", "https://forms.gle/97m9hCsBFovYKKrX7")],
        ]));
      });

      bot.command("admin", async (ctx) => {
        const adminId = env.ADMIN_ID ? Number(env.ADMIN_ID) : undefined;
        if (!adminId || ctx.from.id !== adminId) return;

        const usersRow = await env.DB.prepare(`SELECT COUNT(*) as total FROM users`).first();
        const clicksRow = await env.DB.prepare(`SELECT SUM(hdp) as total_hdp, SUM(omon) as total_omon FROM users`).first();

        ctx.reply(`📊 Statistika:\n\n👥 Foydalanuvchilar: ${usersRow?.total || 0}\n\n🔹 HDP LC bosilgan: ${clicksRow?.total_hdp || 0}\n🔹 Omon School bosilgan: ${clicksRow?.total_omon || 0}`);
      });

      try {
        const update = await request.json();
        await bot.handleUpdate(update as any);
        return new Response("OK");
      } catch (err) {
        console.error("Error handling update:", err);
        return new Response("Error", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};
