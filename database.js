import { Schema, connect, model } from "mongoose";

export async function connectMongo(MONGO_URI) {
    await connect(MONGO_URI)
        .then(() => console.log('Database connected'))
        .catch((error) => console.log(`Error on connecting database: ${error}`));
} 

const userSchema = new Schema({
    userId: { type: Number, unique: true, required: true },
    first_name: { type: String },
    username: { type: String, unique: true },
    status: { type: String, default: 'green' },
    badMessagesCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now() },
    lastActionAt: { type: Date, default: Date.now() }
});

const reviewSchema = new Schema({
    reviewId: { type: Number },
    userId: { type: Number },
    first_name: { type: String },
    username: { type: String },
    message: { type: String }
});

const badWordsSchema = new Schema({
    badWords: { type: String }
});

export const User = model('User', userSchema);
export const Review = model('Review', reviewSchema);
export const BadWords = model('BadWords', badWordsSchema);