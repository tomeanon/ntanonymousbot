import { Markup, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { BadWords, connectMongo, Review, User } from "./database.js";
import { config } from "dotenv";
import fs from "node:fs";

config();

const channelId = process.env.CHANNEL_ID;
const channelUsername = process.env.CHANNEL_USERNAME
const privateChannelId = process.env.PRIVATE_CHANNEL_ID;

const bot = new Telegraf(process.env.BOT_TOKEN);
await connectMongo(process.env.MONGO_URI);

bot.start(async ctx => {
    try {
        const userId = ctx.message.from.id;
        const user = await User.findOne({ userId });
        if (user) return ctx.sendMessage(`Yana bir bor salom, ${user.first_name}`, 
            Markup.inlineKeyboard([Markup.button.url(`Najot Ta'lim Anon`, 'https://t.me/najottalimanon')]));
        const { first_name, username } = ctx.message.from;
        const newUser = await User.create({ userId, first_name, username });
        if (!newUser) throw new Error('User not created');
        return ctx.sendMessage(`Salom, ${first_name}!`,
            Markup.inlineKeyboard([Markup.button.url(`Najot Ta'lim Anon`, 'https://t.me/najottalimanon')]));
        } catch (error) {
            console.log(error);
        }
    });
    
    bot.command('unblock', async ctx => {
        const userId = ctx.message.text.split(' ')[1];
        const user = await User.findOne({ userId });
        user.status = 'green';
        user.badMessagesCount = 0;
        await user.save();
        ctx.sendMessage('Unblocked');
    });

    bot.on(message('text'), async ctx => {
        try {
        const userId = ctx.message.from.id;
        const username = ctx.message.from.username;
        const first_name = ctx.message.from.first_name;
        const message = ctx.message.text;
        const user = await User.findOne({ userId });

        if (user.status === 'red') {
            return ctx.sendMessage('🔐 Uzr, siz bloklangansiz');
        }

        if (Date.now() - user.lastActionAt < 15000) {
            return ctx.sendMessage(`Xabar yozish uchun ${15 - Math.floor((Date.now() - user.lastActionAt) / 1000)} soniya kuting`);
        }
        if (await containsBadWord(message)) {
            const reviewId = Math.round(Math.random() * 1000000);
            const review = { reviewId, userId, first_name, username, message }
            await ctx.telegram.sendMessage(privateChannelId,
                `${message}\n\nuserId: ${userId}\nname: ${first_name}\nusername: ${username ? '@' + username : 'n/a'}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Approve', `approve:${reviewId}`),
                    Markup.button.callback('❌ Reject', `reject:${reviewId}`)]
                ])
            );
            
            await Review.create(review);
            user.lastActionAt = Date.now();
            await user.save();
            return ctx.sendMessage('🔍 Sizning xabaringiz tekshiruv ostida');
        } else if (message.length < 10) {
            return ctx.sendMessage('📏 Xabaringiz kanalga yuborish uchun juda ham qisqa')
        } else if (ctx.message.entities?.some(e => e.type === 'url')) {
            return ctx.sendMessage('❌ Xabaringizda link borligi aniqlandi')
        }
        
        user.lastActionAt = Date.now();
        await user.save();
        const sentMessage = await ctx.telegram.sendMessage(channelId, message);
        const { message_id } = sentMessage;
        ctx.sendMessage('✅ Sizning xabaringiz anonim kanalga yuborildi', 
            Markup.inlineKeyboard([Markup.button.url(`Najot Ta'lim Anon`, `https://t.me/najottalimanon/${message_id}`)])
        );
        
        const userInfo = `\n\nuserId: ${userId}\nname: ${first_name}\nusername: ${username ? '@' + username : 'n/a'}`;

        let buttons = [
            [Markup.button.url('Original Message', `https://t.me/${channelUsername}/${message_id}`)],
            [Markup.button.url(ctx.message.from.first_name, `tg://user?id=${userId}`)]
        ];
        if (username) {
            buttons[1].push(Markup.button.url('@' + username, `https://t.me/${username}`));
        }
        ctx.telegram.sendMessage(privateChannelId, message + userInfo, Markup.inlineKeyboard(buttons));
    } catch (error) {
        console.log(error);
    }
});

bot.on('callback_query', async ctx => {
    const [action, reviewId] = ctx.callbackQuery.data.split(':');
    const review = await Review.findOne({ reviewId });
    const { userId, first_name, username, message } = review;
    const user = await User.findOne({ userId });

    if (action === 'approve' && message) {
        const sentMessage = await ctx.telegram.sendMessage(channelId, message);
        ctx.telegram.sendMessage(userId, '✅ Sizning xabaringiz tasdiqlandi va anonim kanalga yuborildi', 
            Markup.inlineKeyboard([Markup.button.url(`Najot Ta'lim Anon`, `https://t.me/najottalimanon/${sentMessage.message_id}`)])
        );
        await ctx.answerCbQuery("Message approved.");

        let buttons = [
            [Markup.button.url('Original Message', `https://t.me/${channelUsername}/${sentMessage.message_id}`)],
            [Markup.button.url(first_name, `tg://user?id=${userId}`)]
        ];
        if (username) {
            buttons[1].push(Markup.button.url('@' + username, `https://t.me/${username}`));
        }

        await ctx.telegram.copyMessage(privateChannelId, privateChannelId, ctx.callbackQuery.message.message_id, Markup.inlineKeyboard(buttons));
        await ctx.telegram.deleteMessage(privateChannelId, ctx.callbackQuery.message.message_id);
        await Review.findOneAndDelete({ reviewId });
    } else if (action === 'reject') {
        ctx.telegram.sendMessage(userId, '❌ Sizning xabaringiz rad etildi')
        await ctx.answerCbQuery("Message rejected.");

        let buttons = [
            [Markup.button.callback('Rejected', `hello`)],
            [Markup.button.url(first_name, `tg://user?id=${userId}`)]
        ];
        if (username) {
            buttons[1].push(Markup.button.url('@' + username, `https://t.me/${username}`));
        }

        user.badMessagesCount++;
        if (user.badMessagesCount >= 5)
            user.status = 'red';
        await user.save();
        
        await ctx.telegram.copyMessage(privateChannelId, privateChannelId, ctx.callbackQuery.message.message_id, Markup.inlineKeyboard(buttons));
        await ctx.telegram.deleteMessage(privateChannelId, ctx.callbackQuery.message.message_id);
        await Review.findOneAndDelete({ reviewId });
    }
});


async function containsBadWord(message) {
    const badWordsDB = await BadWords.findById('68aa88a63915e8d6b435316f');
    const { badWords } = badWordsDB;
    message = message
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "");
    for (let badWord of badWords.split('\n').reverse()) {
        if (message.split(' ').includes(badWord)) {
            console.log(badWord);
            return true;
        } else if (badWord.length > 4) {
            const wholeText = message.replace(/\s+/g, "");
            for (let i = 0; i < wholeText.length; i++) {
                if (wholeText.startsWith(badWord, i)) {
                    console.log(badWord);
                    return true;
                }
            }
        } else {
            for (let word of (message.split(' '))) {
                if (word.startsWith(badWord)) {
                    console.log(badWord);
                    return true;
                }
            }
        }
    }
    return false;
}

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));