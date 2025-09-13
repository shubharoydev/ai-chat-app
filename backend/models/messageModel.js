import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: String, 
      required: true,
    },
    friendId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isAI: { type: Boolean,
    default: false 
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    // status: {
    //   type: String,
    //   enum: ['sent', 'delivered', 'read'],
    //   default: 'sent',
    // },
  },
  { timestamps: true }
);

// Index for efficient chat history retrieval
messageSchema.index({ chatId: 1, timestamp: -1 });

export const Message = mongoose.model('Message', messageSchema);

