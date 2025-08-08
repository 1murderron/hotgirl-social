// Username validation function for the server

// List of restricted usernames
const RESTRICTED_USERNAMES = [
  'admin', 'administrator', 'root', 'api', 'www', 'mail', 'email',
  'support', 'help', 'info', 'contact', 'about', 'terms', 'privacy',
  'login', 'register', 'signup', 'signin', 'logout', 'dashboard',
  'profile', 'user', 'users', 'account', 'settings', 'config',
  'hotgirl', 'hotgirlsocial', 'official', 'staff', 'moderator',
  'null', 'undefined', 'true', 'false', 'test', 'demo', 'contact', 'privacy'
];


function validateUsername(username) {
    const errors = [];
    
    // Check if username exists
    if (!username || typeof username !== 'string') {
        return { isValid: false, errors: ['Username is required'] };
    }

    // Check if username is restricted
    if (RESTRICTED_USERNAMES.includes(username.toLowerCase())) {
        errors.push('This username is not available');
    }
    
    // Check length
    if (username.length < 3) {
        errors.push('Username must be at least 3 characters long');
    }
    if (username.length > 30) {
        errors.push('Username must be 30 characters or less');
    }
    
    // Check for valid characters (only letters, numbers, underscore, hyphen)
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(username)) {
        errors.push('Username can only contain letters, numbers, underscores, and hyphens');
    }
    
    // Must start with letter or number
    if (!/^[a-zA-Z0-9]/.test(username)) {
        errors.push('Username must start with a letter or number');
    }
    
    // Must end with letter or number
    if (!/[a-zA-Z0-9]$/.test(username)) {
        errors.push('Username must end with a letter or number');
    }
    
    // No double underscores or hyphens
    if (/[_-]{2,}/.test(username)) {
        errors.push('Username cannot have consecutive underscores or hyphens');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

// Export so server.js can use this function
module.exports = {
    validateUsername
};