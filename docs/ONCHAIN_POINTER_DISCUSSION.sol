// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract PointerRegistry is Ownable2Step {
    struct Pointer {
        uint64 version;
        uint64 updatedAt;
        uint64 payloadSize;      // optional; 0 means "unknown"
        bytes32 payloadSha256;   // sha256 of the exact bytes fetched from CID/URL
        string cid;              // CIDv1 string (optional but recommended)
        string[] urls;           // fallback URLs (at least one)
    }

    Pointer private _p;

    event PointerUpdated(
        uint64 indexed version,
        bytes32 indexed payloadSha256,
        uint64 payloadSize,
        string cid,
        string[] urls,
        uint64 updatedAt
    );

    constructor(address initialOwner) {
        _transferOwnership(initialOwner);
    }

    function updatePointer(
        uint64 newVersion,
        bytes32 newPayloadSha256,
        uint64 newPayloadSize,
        string calldata newCid,
        string[] calldata newUrls
    ) external onlyOwner {
        require(newVersion > _p.version, "version must increase");
        require(newPayloadSha256 != bytes32(0), "sha256 required");
        require(newUrls.length != 0, "at least one url required");
        require(newUrls.length <= 12, "too many urls"); // safety cap

        _p.version = newVersion;
        _p.updatedAt = uint64(block.timestamp);
        _p.payloadSha256 = newPayloadSha256;
        _p.payloadSize = newPayloadSize;
        _p.cid = newCid; // can be "" if you rely only on URLs

        delete _p.urls;
        for (uint256 i = 0; i < newUrls.length; i++) {
            _p.urls.push(newUrls[i]);
        }

        emit PointerUpdated(_p.version, _p.payloadSha256, _p.payloadSize, _p.cid, _p.urls, _p.updatedAt);
    }

    function latest()
        external
        view
        returns (
            uint64 version,
            uint64 updatedAt,
            bytes32 payloadSha256,
            uint64 payloadSize,
            string memory cid,
            string[] memory urls
        )
    {
        return (_p.version, _p.updatedAt, _p.payloadSha256, _p.payloadSize, _p.cid, _p.urls);
    }

    function version() external view returns (uint64) { return _p.version; }
    function urlsCount() external view returns (uint256) { return _p.urls.length; }
}


