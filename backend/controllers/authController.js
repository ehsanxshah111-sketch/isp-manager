const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const generateToken = (id, role) => {
  return jwt.sign(
    { userId: id, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

// @desc    Register user
exports.register = async (req, res) => {
  try {
    const { username, email, password, fullName, role } = req.body;

    let user = await User.findOne({ $or: [{ username }, { email }] });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      username,
      email,
      password: hashedPassword,
      fullName,
      role: role || 'staff'
    });
    await user.save();

    await ActivityLog.create({
      user: username,
      action: 'User Registered',
      details: `New user registered: ${username}`,
      module: 'Auth'
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login user
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id, user.role);

    await ActivityLog.create({
      user: username,
      userId: user._id,
      action: 'User Login',
      details: `User ${username} logged in`,
      module: 'Auth'
    });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get current user
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update profile (fullName only)
exports.updateProfile = async (req, res) => {
  try {
    const { fullName } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (fullName !== undefined && fullName.trim() !== '') {
      user.fullName = fullName.trim();
    }

    await user.save();

    await ActivityLog.create({
      user: user.username,
      userId: req.userId,
      action: 'Profile Updated',
      details: `User ${user.username} updated their profile`,
      module: 'Auth'
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Please provide both passwords' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.userId).select('+password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    await ActivityLog.create({
      user: user.username,
      userId: req.userId,
      action: 'Password Changed',
      details: `User ${user.username} changed their password`,
      module: 'Auth'
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Change username
exports.changeUsername = async (req, res) => {
  try {
    const { newUsername } = req.body;

    if (!newUsername || newUsername.trim() === '') {
      return res.status(400).json({ message: 'Username cannot be empty' });
    }

    if (newUsername.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      return res.status(400).json({ message: 'Username can only contain letters, numbers, and underscore' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const existingUser = await User.findOne({ 
      username: newUsername.trim(), 
      _id: { $ne: req.userId } 
    });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const oldUsername = user.username;
    user.username = newUsername.trim();
    await user.save();

    await ActivityLog.create({
      user: user.username,
      userId: req.userId,
      action: 'Username Changed',
      details: `Username changed from ${oldUsername} to ${user.username}`,
      module: 'Auth'
    });

    const token = generateToken(user._id, user.role);

    res.json({
      success: true,
      message: 'Username updated successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Change username error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Logout
exports.logout = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (user) {
      await ActivityLog.create({
        user: user.username,
        userId: req.userId,
        action: 'User Logout',
        details: `User ${user.username} logged out`,
        module: 'Auth'
      });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: error.message });
  }
};