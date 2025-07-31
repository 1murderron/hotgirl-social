// Username validation function for the server
function validateUsername(username) {
    const errors = [];
    
    // Check if username exists
    if (!username || typeof username !== 'string') {
        return { isValid: false, errors: ['Username is required'] };
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