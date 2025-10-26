--[[
    Bizhawk SMW Level Name Extractor
    
    Extracts level data from RAM while game is running.
    Bypasses all ROM obfuscation by reading decompressed/loaded data.
    
    Usage:
        1. Load ROM in Bizhawk
        2. Tools > Lua Console
        3. Load this script
        4. Let it run until overworld loads
        5. Check output.json for extracted data
]]

-- Configuration
local OUTPUT_FILE = "bizhawk_level_extract.json"
local DEBUG = true

-- State tracking
local extraction_done = false
local current_level_extracted = {}
local all_levels_data = {}
local frame_count = 0

-- SMW Character encoding (for decoding text from RAM)
local SNES_CHARSET = {
    [0x00] = 'A', [0x01] = 'B', [0x02] = 'C', [0x03] = 'D',
    [0x04] = 'E', [0x05] = 'F', [0x06] = 'G', [0x07] = 'H',
    [0x08] = 'I', [0x09] = 'J', [0x0A] = 'K', [0x0B] = 'L',
    [0x0C] = 'M', [0x0D] = 'N', [0x0E] = 'O', [0x0F] = 'P',
    [0x10] = 'Q', [0x11] = 'R', [0x12] = 'S', [0x13] = 'T',
    [0x14] = 'U', [0x15] = 'V', [0x16] = 'W', [0x17] = 'X',
    [0x18] = 'Y', [0x19] = 'Z', [0x1F] = ' ',
    [0x64] = '1', [0x65] = '2', [0x66] = '3', [0x67] = '4',
    [0x68] = '5', [0x69] = '6', [0x6A] = '7', [0x6B] = '8',
    [0x6C] = '9', [0x6D] = '0',
}

-- Read a byte from WRAM
function read_wram(addr)
    memory.usememorydomain("WRAM")
    return memory.readbyte(addr)
end

-- Read a word (2 bytes) from WRAM
function read_wram_word(addr)
    memory.usememorydomain("WRAM")
    local low = memory.readbyte(addr)
    local high = memory.readbyte(addr + 1)
    return low | (high << 8)
end

-- Decode SMW text from RAM
function decode_smw_text(addr, max_length)
    local text = ""
    local length = 0
    
    for i = 0, max_length - 1 do
        local byte_val = read_wram(addr + i)
        
        -- Check for end marker (bit 7 set)
        if (byte_val & 0x80) ~= 0 then
            byte_val = byte_val & 0x7F
            if SNES_CHARSET[byte_val] then
                text = text .. SNES_CHARSET[byte_val]
            end
            break
        end
        
        -- Normal character
        if SNES_CHARSET[byte_val] then
            text = text .. SNES_CHARSET[byte_val]
            length = length + 1
        elseif byte_val == 0xFF then
            -- Padding, stop here
            break
        else
            -- Unknown character
            text = text .. string.format("[%02X]", byte_val)
        end
    end
    
    return text:match("^%s*(.-)%s*$")  -- Trim whitespace
end

-- Check if we're on the overworld
function is_on_overworld()
    local game_mode = read_wram(0x0100)
    -- Game mode 0x0E = overworld
    return game_mode == 0x0E or game_mode == 0x0F
end

-- Extract current level data
function extract_current_level()
    local level_id = read_wram(0x13BF)  -- Current level number
    local level_id_high = read_wram(0x19D8)  -- High byte
    
    -- Calculate full level ID (0x000-0x1FF)
    local full_level_id = level_id
    if (level_id_high & 0x01) ~= 0 then
        full_level_id = level_id + 0x100
    end
    
    -- Read overworld tile (if on overworld)
    local ow_tile = read_wram(0x13C1)
    
    -- Read translevel number
    local translevel = read_wram(0x1F11)
    
    -- Try to extract level name from various RAM locations
    local level_name = ""
    
    -- Method 1: Check OAM area for text sprites
    -- Level names are usually displayed as OAM sprites on overworld
    -- OAM table starts at $0200 (WRAM)
    
    -- Method 2: Scan tilemap area
    -- Overworld names might be in tilemap at $7F6000+
    
    -- Method 3: Check status bar area ($0EF9-$0F2F)
    -- Names sometimes displayed here
    
    -- For now, try scanning a range for readable text
    -- Common areas: $7E1000-$7E2000, $7F0000-$7F8000
    
    return {
        level_id = string.format("0x%03X", full_level_id),
        level_id_low = level_id,
        level_id_high = level_id_high,
        overworld_tile = ow_tile,
        translevel = translevel,
        level_name = level_name,
    }
end

-- Scan RAM for level names
function scan_for_level_names()
    -- Scan WRAM for readable SMW-encoded text
    local names_found = {}
    
    -- Scan ranges where level names might be loaded
    local scan_ranges = {
        {start = 0x1000, stop = 0x2000, desc = "General RAM"},
        {start = 0x6000, stop = 0x7000, desc = "High RAM"},
    }
    
    for _, range in ipairs(scan_ranges) do
        local addr = range.start
        while addr < range.stop do
            -- Try to decode text at this position
            local text = decode_smw_text(addr, 24)
            
            -- If we found readable text (5+ letters)
            local letter_count = 0
            for c in text:gmatch("%a") do
                letter_count = letter_count + 1
            end
            
            if letter_count >= 5 and #text >= 5 then
                table.insert(names_found, {
                    address = string.format("0x%04X", addr),
                    text = text,
                    length = #text
                })
                
                if DEBUG then
                    console.log(string.format("Found text at $%04X: %s", addr, text))
                end
                
                -- Skip ahead to avoid duplicates
                addr = addr + #text
            else
                addr = addr + 1
            end
        end
    end
    
    return names_found
end

-- Main extraction loop
function main_loop()
    emu.frameadvance()
    frame_count = frame_count + 1
    
    -- Wait for overworld to load
    if not is_on_overworld() then
        if frame_count % 60 == 0 and DEBUG then
            local game_mode = read_wram(0x0100)
            console.log(string.format("Waiting for overworld... (mode: 0x%02X)", game_mode))
        end
        return
    end
    
    -- On overworld, start extracting
    if not extraction_done then
        console.log("=" .. string.rep("=", 69))
        console.log("OVERWORLD DETECTED - Beginning Extraction")
        console.log("=" .. string.rep("=", 69))
        
        local rom_name = gameinfo.getromname()
        local rom_hash = gameinfo.getromhash()
        
        console.log(string.format("ROM: %s", rom_name))
        console.log(string.format("Hash: %s", rom_hash))
        console.log("")
        
        -- Extract current level
        local current_level = extract_current_level()
        console.log(string.format("Current Level: %s", current_level.level_id))
        console.log(string.format("Overworld Tile: 0x%02X", current_level.overworld_tile))
        console.log("")
        
        -- Scan for level names in RAM
        console.log("Scanning RAM for level names...")
        local names = scan_for_level_names()
        console.log(string.format("Found %d potential names", #names))
        console.log("")
        
        -- Build output data
        local output = {
            rom_name = rom_name,
            rom_hash = rom_hash,
            extraction_time = os.date("%Y-%m-%d %H:%M:%S"),
            current_level = current_level,
            ram_text_found = names,
        }
        
        -- Write JSON output
        local json_str = json_encode(output)
        local file = io.open(OUTPUT_FILE, 'w')
        if file then
            file:write(json_str)
            file:close()
            console.log(string.format("✓ Data written to %s", OUTPUT_FILE))
        else
            console.log(string.format("✗ Failed to write %s", OUTPUT_FILE))
        end
        
        extraction_done = true
        console.log("")
        console.log("EXTRACTION COMPLETE - You may close the emulator")
    end
end

-- Simple JSON encoder
function json_encode(obj, indent)
    indent = indent or 0
    local t = type(obj)
    
    if t == "table" then
        local is_array = true
        local count = 0
        for k, v in pairs(obj) do
            count = count + 1
            if type(k) ~= "number" or k ~= count then
                is_array = false
                break
            end
        end
        
        local ind_str = string.rep("  ", indent)
        local ind_str_inner = string.rep("  ", indent + 1)
        
        if is_array then
            local parts = {}
            for i, v in ipairs(obj) do
                table.insert(parts, ind_str_inner .. json_encode(v, indent + 1))
            end
            return "[\n" .. table.concat(parts, ",\n") .. "\n" .. ind_str .. "]"
        else
            local parts = {}
            for k, v in pairs(obj) do
                local key = string.format('"%s"', k)
                table.insert(parts, ind_str_inner .. key .. ": " .. json_encode(v, indent + 1))
            end
            return "{\n" .. table.concat(parts, ",\n") .. "\n" .. ind_str .. "}"
        end
    elseif t == "string" then
        -- Escape quotes
        local escaped = obj:gsub('"', '\\"')
        return '"' .. escaped .. '"'
    elseif t == "number" then
        return tostring(obj)
    elseif t == "boolean" then
        return obj and "true" or "false"
    else
        return '"(unknown)"'
    end
end

-- Event handlers
event.onexit(function()
    if extraction_done then
        console.log("Extraction completed successfully")
    else
        console.log("Extraction incomplete - script terminated early")
    end
end)

-- Main loop
console.log("SMW Level Name Extractor - Starting...")
console.log("Waiting for overworld to load...")

while true do
    main_loop()
end
PYEOF

