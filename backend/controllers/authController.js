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

// SIGNUP //

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

    res.cookie('refreshToken', refreshToken, {    
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: ms(jwtRefreshExpiry),
    });
    res
      .status(201)
      .json({ message: 'User created', user: { id: user._id, name, email } });
  } catch (error) {
    next(error);
  }
};

// LOGIN //

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


    res.cookie('refreshToken', refreshToken, {    
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: ms(jwtRefreshExpiry),
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
        accessToken,refreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};


// REFRESH TOKEN //

export const refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
      return next(createError(400, 'Refresh token is required'));
    }


    //  Verify JWT first (this works even if Redis is dead)
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, jwtRefreshSecret);
    } catch (err) {
      return next(createError(401, 'Invalid or expired refresh token'));
    }


    // Try Redis blacklist check — BUT make it NON-BLOCKING
    let isRevoked = false;
    try {
      const redisClient = getRedisClient();
      if (redisClient.isReady) {
        const stored = await redisClient.get(`revoked:refresh:${decoded.userId}`);
        if (stored === 'true') isRevoked = true;
      }
      // If Redis is down → we skip this check (security trade-off, but app stays alive)
    } catch (redisErr) {
      console.warn('Redis unavailable during token refresh – skipping revocation check', redisErr.message);
      // Continue anyway — better than crashing entire auth system
    }


    if (isRevoked) {
      return next(createError(401, 'Refresh token has been revoked'));
    }

    //  Optional: Validate user still exists in DB
    const user = await User.findById(decoded.userId);
    if (!user) {
      return next(createError(401, 'User not found'));
    }

    //  Generate new access token
    const newAccessToken = jwt.sign(
      { userId: decoded.userId },
      jwtAccessSecret,
      { expiresIn: jwtAccessExpiry }
    );


    //  Set new access token cookie
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ms(jwtAccessExpiry),
    });


    return res.json({
      message: 'Token refreshed',
      accessToken: newAccessToken,
      userId: decoded.userId,
    });

  } catch (error) {
    next(error);
  }
};


// LOGOUT //

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

    res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    });

    res.status(200).json({ message: 'Logout successful' });
  } catch (error) {
    next(error);
  }
};