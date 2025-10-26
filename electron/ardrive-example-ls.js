//import { arDriveFactory } from 'ardrive-core-js';
//

const arDriveCore = require('ardrive-core-js')

async function generateWallet() {
   return (arDriveCore.readJWKFile('dummy.json'));
}

console.log( JSON.stringify(generateWallet()));
//const arDrive = arDriveCore.arDriveFactory( {wallet: generateWallet() }); 
//
//
const DEFAULT_GATEWAY = 'https://arweave.net:443';
const arweave_1 = require("arweave");

function getArweaveFromURL(url) {
    return arweave_1.init({
        host: url.hostname,
        protocol: url.protocol.replace(':', ''),
        port: url.port,
        timeout: 600000
    });
}


const arweave =getArweaveFromURL(new URL(DEFAULT_GATEWAY));
const arDrive = arDriveCore.arDriveAnonymousFactory({  arweave: arweave  });


async function listPublicDriveFiles(folderId) {
        try {
            const getFiles = await arDrive.listPublicFolder({ folderId: folderId, maxDepth: 3 });
            console.log("Files in public folder:", getFiles);
            return getFiles;
        } catch (error) {
            console.error("Error listing public drive files:", error);
            throw error;
        }
}

// Example usage:
// drive id 58677413-8a0c-4982-944d-4a1b40454039
//                          07b13d74-e426-4012-8c6d-cba0927012fb
    const publicFolderId = arDriveCore.EID("07b13d74-e426-4012-8c6d-cba0927012fb"); // Replace with your actual folder ID
    listPublicDriveFiles(publicFolderId)
        .then(children => {
            // Process the list of files and folders
            if (children && children.length > 0) {
                children.forEach(item => {
                    console.log(`Name: ${item.name}, Type: ${item.entityType}, ID: ${item.entityId}, Path: ${item.path}`);
                });
            } else {
                console.log('No files or folders found.');
            }
        })
        .catch(err => {
            console.error("Failed to list files:", err);
        });
//
//
