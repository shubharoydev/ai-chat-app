import jwt from 'jsonwebtoken';
import { User } from '../models/userModel.js';
import ms from 'ms';
import { getRedisClient } from '../config/redisSetup.js'; 
import { producer } from '../config/kafka.js';
import {
  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessExpiry,
  jwtRefreshExpiry,
} from '../config/env.js';
import {
  signupSchema,
  loginSchema,
} from '../utils/validator.js'; 
import { createError } from '../utils/errorHandler.js';

export const signup = async (req, res, next) => {
  try {
    const { error } = signupSchema.validate(req.body);
    if (error) throw createError(400, error.details[0].message);

    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) throw createError(409, 'Email already exists');

    const user = new User({ name, email, password });
    await user.save();

    const accessToken = jwt.sign({ userId: user._id }, jwtAccessSecret, {
      expiresIn: jwtAccessExpiry,
    });
    const refreshToken = jwt.sign({ userId: user._id }, jwtRefreshSecret, {
      expiresIn: jwtRefreshExpiry,
    });

    const redisClient = getRedisClient();
    await redisClient.setWithExpiry(
      `refresh:${user._id}`,
      refreshToken,
      ms(jwtRefreshExpiry) / 1000
    );

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ms(jwtAccessExpiry),
    });

    await producer.send({
      topic: 'user-events',
      messages: [
        {
          value: JSON.stringify({
            event: 'user_signup',
            userId: user._id,
            email,
          }),
        },
      ],
    });

    res
      .status(201)
      .json({ message: 'User created', user: { id: user._id, name, email } });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      console.log('Validation error:', error.details[0].message);
      throw createError(400, error.details[0].message);
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found for email:', email);
      throw createError(401, 'Invalid email or password');
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      console.log('Invalid password for user:', email);
      throw createError(401, 'Invalid email or password');
    }

    console.log('JWT Secret:', jwtAccessSecret ? 'Set' : 'Not set');
    console.log('JWT Expiry:', jwtAccessExpiry);

    const accessToken = jwt.sign({ userId: user._id }, jwtAccessSecret, {
      expiresIn: jwtAccessExpiry,
    });
    const refreshToken = jwt.sign({ userId: user._id }, jwtRefreshSecret, {
      expiresIn: jwtRefreshExpiry,
    });

    const redisClient = getRedisClient();
    await redisClient.setWithExpiry(
      `refresh:${user._id}`,
      refreshToken,
      ms(jwtRefreshExpiry) / 1000
    );

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ms(jwtAccessExpiry),
    });

    console.log('Login successful for user:', user.email);

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
      tokens: {
        accessToken
      }
    });
  } catch (error) {
    next(error);
  }
};

// export const refreshToken = async (req, res, next) => {
//   try {
//     const { userId } = req.body;
//     if (!userId) throw createError(400, 'User ID is required');

//     const redisClient = getRedisClient();
//     const storedRefreshToken = await redisClient.get(`refresh:${userId}`);

//     if (!storedRefreshToken)
//       throw createError(401, 'Invalid or expired refresh token');

//     const decoded = jwt.verify(storedRefreshToken, jwtRefreshSecret);

//     const newAccessToken = jwt.sign(
//       { userId: decoded.userId },
//       jwtAccessSecret,
//       { expiresIn: jwtAccessExpiry }
//     );

//     res.cookie('accessToken', newAccessToken, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production',
//       sameSite: 'strict',
//       maxAge: ms(jwtAccessExpiry),
//     });

//     res.json({ accessToken: newAccessToken, userId: decoded.userId });
//   } catch (error) {
//     if (error instanceof jwt.JsonWebTokenError) {
//       return next(createError(401, 'Invalid refresh token'));
//     }
//     next(error);
//   }
// };

export const refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) throw createError(400, 'Refresh token is required');

    const decoded = jwt.verify(refreshToken, jwtRefreshSecret);

    const redisClient = getRedisClient();
    const storedRefreshToken = await redisClient.get(`refresh:${decoded.userId}`);

    if (storedRefreshToken !== refreshToken) {
      throw createError(401, 'Invalid or expired refresh token');
    }

    // issue new tokens
    const newAccessToken = jwt.sign(
      { userId: decoded.userId },
      jwtAccessSecret,
      { expiresIn: jwtAccessExpiry }
    );

    const newRefreshToken = jwt.sign(
      { userId: decoded.userId },
      jwtRefreshSecret,
      { expiresIn: jwtRefreshExpiry }
    );

    // rotate refresh token in Redis
    await redisClient.set(
      `refresh:${decoded.userId}`,
      newRefreshToken,
      'EX',
      ms(jwtRefreshExpiry) / 1000
    );

    // set new refresh token in httpOnly cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ms(jwtRefreshExpiry),
    });

    // return new access token in JSON
    res.json({ accessToken: newAccessToken, userId: decoded.userId });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(createError(401, 'Invalid refresh token'));
    }
    next(error);
  }
};



export const logout = async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) throw createError(400, 'User ID is required');

    const redisClient = getRedisClient();
    await redisClient.del(`refresh:${userId}`);

    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.status(200).json({ message: 'Logout successful' });
  } catch (error) {
    next(error);
  }
};