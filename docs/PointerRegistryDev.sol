/// DEV: 0xDFe373E16dE6c61209D199Fc4eA4236F47824740


//import "@openzeppelin/contracts/access/Ownable2Step.sol";
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
//import "@openzeppelin/contracts/access/Ownable2Step.sol";
//import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.3/contracts/access/Ownable2Step.sol";


contract PointerRegistry is Ownable2Step {
    string public name;

    struct Pointer {
        uint64 version;
        uint64 updatedAt;
        uint64 payloadSize;      // optional; 0 means "unknown"
        bytes32 payloadSha256;   // sha256 of the exact bytes fetched from CID/
        string cid;              // CIDv1 string (optional but recommended)
        string[] brefs;           // fallback BREFs
    }

    Pointer private _p;

    event PointerUpdated(
        uint64 indexed version,
        bytes32 indexed payloadSha256,
        uint64 payloadSize,
        string cid,
        string[] brefs,
        uint64 updatedAt
    );

    constructor(address initialOwner) /* Ownable2Step(initialOwner)*/ {       
        name = "RHP0120 Base Manifest Pointers DEV";
        // _transferOwnership(initialOwner);
    }

    function updatePointer(
        uint64 newVersion,
        bytes32 newPayloadSha256,
        uint64 newPayloadSize,
        string calldata newCid,
        string[] calldata newBrefs
    ) external onlyOwner {
        require(newVersion > _p.version, "version must increase");
        require(newPayloadSha256 != bytes32(0), "sha256 required");
        require(newBrefs.length >= 0, "0 or 1+ bref required");
        require(newBrefs.length <= 12, "too many brefs"); // safety cap

        _p.version = newVersion;
        _p.updatedAt = uint64(block.timestamp);
        _p.payloadSha256 = newPayloadSha256;
        _p.payloadSize = newPayloadSize;
        _p.cid = newCid; // can be "" if you rely only on BREFs

        delete _p.brefs;
        for (uint256 i = 0; i < newBrefs.length; i++) {
            _p.brefs.push(newBrefs[i]);
        }

        emit PointerUpdated(_p.version, _p.payloadSha256, _p.payloadSize, _p.cid, _p.brefs, _p.updatedAt);
    }

    function latest()
        external
        view
        returns (
            uint64 currentVersion,
            uint64 updatedAt,
            bytes32 payloadSha256,
            uint64 payloadSize,
            string memory cid,
            string[] memory brefs
        )
    {
        return (_p.version, _p.updatedAt, _p.payloadSha256, _p.payloadSize, _p.cid, _p.brefs);
    }

    function version() external view returns (uint64) { return _p.version; }
    function brefsCount() external view returns (uint256) { return _p.brefs.length; }
}



