const bcrypt = require('bcryptjs');

async function createAdmin() {
    const password = 'Ou8125150$%^'; // Change this to your desired password
    const hash = await bcrypt.hash(password, 10);
    console.log('Copy this hashed password:');
    console.log(hash);
}

createAdmin();