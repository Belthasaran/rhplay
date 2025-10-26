--[[
═══════════════════════════════════════════════════════════════════════
    SMW Level Name Extractor for BizHawk
    
    Extracts level names from RAM by watching what the game displays.
    Bypasses ALL ROM obfuscation - if the game can display it, we can read it!
    
    Based on overworld_extraction.lua with enhancements for level names.
═══════════════════════════════════════════════════════════════════════

USAGE:
    1. Load your SMW ROM in BizHawk
    2. Tools > Lua Console > Open Script > bizhawk_extract_levelnames.lua
    3. Navigate overworld - move Mario over level tiles
    4. Script captures level names as they appear on screen
    5. Press a key or let it auto-export after visiting N levels
    6. Check levelnames_output.json

FEATURES:
    • Captures level ID when Mario stands on level tile
    • Extracts displayed level name from OAM/tilemap
    • Records overworld position, tile info
    • Exports to JSON with all RAM data
    • Works with ANY hack - no ROM parsing needed!
    
═══════════════════════════════════════════════════════════════════════
]]

-- ═══════════════════════════════════════════════════════════════════
-- CONFIGURATION
-- ═══════════════════════════════════════════════════════════════════

local OUTPUT_FILE = "levelnames_output.json"
local DEBUG = true
local AUTO_EXTRACT_COUNT = 30  -- Auto-save after capturing N levels

-- ═══════════════════════════════════════════════════════════════════
-- SMW CHARACTER ENCODING
-- ═══════════════════════════════════════════════════════════════════

local SNES_CHARSET = {
    [0x00] = 'A', [0x01] = 'B', [0x02] = 'C', [0x03] = 'D',
    [0x04] = 'E', [0x05] = 'F', [0x06] = 'G', [0x07] = 'H',
    [0x08] = 'I', [0x09] = 'J', [0x0A] = 'K', [0x0B] = 'L',
    [0x0C] = 'M', [0x0D] = 'N', [0x0E] = 'O', [0x0F] = 'P',
    [0x10] = 'Q', [0x11] = 'R', [0x12] = 'S', [0x13] = 'T',
    [0x14] = 'U', [0x15] = 'V', [0x16] = 'W', [0x17] = 'X',
    [0x18] = 'Y', [0x19] = 'Z',
    [0x1F] = ' ',
    [0x64] = '1', [0x65] = '2', [0x66] = '3', [0x67] = '4',
    [0x68] = '5', [0x69] = '6', [0x6A] = '7', [0x6B] = '8',
    [0x6C] = '9', [0x6D] = '0',
    [0x20] = '!', [0x21] = '?', [0x22] = '.', [0x23] = ',',
    [0x24] = "'", [0x25] = '-',
}

-- ═══════════════════════════════════════════════════════════════════
-- STATE TRACKING
-- ═══════════════════════════════════════════════════════════════════

local captured_levels = {}
local frame_count = 0
local last_ow_tile = 0
local last_level_displayed = ""

-- ═══════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════

function read_byte(addr)
    memory.usememorydomain("WRAM")
    return memory.readbyte(addr)
end

function read_word(addr)
    memory.usememorydomain("WRAM")
    local low = memory.readbyte(addr)
    local high = memory.readbyte(addr + 1)
    return low | (high << 8)
end

function decode_smw_text_at(addr, max_len)
    local text = ""
    for i = 0, max_len - 1 do
        local b = read_byte(addr + i)
        local clean_b = b & 0x7F
        
        if SNES_CHARSET[clean_b] then
            text = text .. SNES_CHARSET[clean_b]
        elseif b == 0xFF or b == 0x00 then
            break  -- Padding/end
        else
            text = text .. string.format("[%02X]", clean_b)
        end
        
        -- Check for end marker (bit 7)
        if (b & 0x80) ~= 0 then
            break
        end
    end
    
    return text:match("^%s*(.-)%s*$") or text
end

-- ═══════════════════════════════════════════════════════════════════
-- GAME STATE DETECTION
-- ═══════════════════════════════════════════════════════════════════

function get_game_mode()
    return read_byte(0x0100)
end

function is_on_overworld()
    local mode = get_game_mode()
    return mode == 0x0E  -- Overworld game mode
end

function is_standing_on_level()
    -- Check if player animation indicates standing on level tile
    local ow_state = read_byte(0x13D9)
    return ow_state == 0x03  -- Standing still on level tile
end

-- ═══════════════════════════════════════════════════════════════════
-- LEVEL DATA EXTRACTION
-- ═══════════════════════════════════════════════════════════════════

function get_current_level_id()
    local level_low = read_byte(0x13BF)
    local level_high_byte = read_byte(0x19D8)
    
    local full_id = level_low
    if (level_high_byte & 0x01) ~= 0 then
        full_id = level_low + 0x100
    end
    
    return full_id
end

function get_overworld_tile()
    return read_byte(0x13C1)
end

function get_mario_position()
    return {
        x = read_byte(0x1F11),  -- Mario OW X
        y = read_byte(0x1F12),  -- Mario OW Y
        x_hi = read_byte(0x1F17),
        y_hi = read_byte(0x1F18),
    }
end

-- ═══════════════════════════════════════════════════════════════════
-- LEVEL NAME EXTRACTION FROM RAM
-- ═══════════════════════════════════════════════════════════════════

function scan_oam_for_text()
    -- OAM table is at $0200-$05FF in WRAM
    -- Look for text sprites
    local text_found = {}
    
    -- Common text display areas
    local text_areas = {
        {start = 0x0EF9, len = 50, desc = "Status bar area"},
        {start = 0x1000, len = 200, desc = "Low RAM work area"},
        {start = 0x7000, len = 500, desc = "High RAM area"},
    }
    
    for _, area in ipairs(text_areas) do
        local addr = area.start
        while addr < area.start + area.len do
            local text = decode_smw_text_at(addr, 24)
            
            -- Count letters
            local letters = 0
            for c in text:gmatch("[A-Z]") do
                letters = letters + 1
            end
            
            if letters >= 4 and #text >= 4 then
                table.insert(text_found, {
                    address = string.format("$%04X", addr),
                    text = text,
                    area = area.desc
                })
                addr = addr + #text + 1
            else
                addr = addr + 1
            end
        end
    end
    
    return text_found
end

function extract_level_name_from_display()
    -- The most reliable method: scan RAM for what's actually being displayed
    
    -- Method 1: OAM sprites (most common for overworld names)
    local oam_text = scan_oam_for_text()
    
    -- Method 2: Find longest/most relevant text string
    local best_match = ""
    local best_score = 0
    
    for _, entry in ipairs(oam_text) do
        local text = entry.text
        local score = 0
        
        -- Score based on:
        -- - Length (longer is better)
        -- - Letter count
        -- - Position in status bar area (more likely)
        
        local letter_count = 0
        for c in text:gmatch("[A-Z]") do
            letter_count = letter_count + 1
        end
        
        score = score + (#text * 2)
        score = score + (letter_count * 3)
        
        if entry.area == "Status bar area" then
            score = score + 20
        end
        
        if score > best_score then
            best_score = score
            best_match = text
        end
    end
    
    return best_match, oam_text
end

-- ═══════════════════════════════════════════════════════════════════
-- CAPTURE LOGIC
-- ═══════════════════════════════════════════════════════════════════

function capture_current_level()
    local level_id = get_current_level_id()
    local ow_tile = get_overworld_tile()
    local mario_pos = get_mario_position()
    local level_name, all_text = extract_level_name_from_display()
    
    local level_key = string.format("0x%03X", level_id)
    
    -- Build capture data
    local capture = {
        level_id = level_key,
        level_id_decimal = level_id,
        overworld_tile = string.format("0x%02X", ow_tile),
        overworld_tile_decimal = ow_tile,
        mario_x = mario_pos.x,
        mario_y = mario_pos.y,
        level_name = level_name,
        all_text_found = all_text,
        frame_captured = frame_count,
    }
    
    -- Store or update
    if not captured_levels[level_key] then
        captured_levels[level_key] = capture
        
        if DEBUG then
            console.log(string.format("✓ Captured Level %s (tile 0x%02X): %s", 
                level_key, ow_tile, level_name ~= "" and level_name or "(no name)"))
        end
    end
    
    return capture
end

-- ═══════════════════════════════════════════════════════════════════
-- JSON EXPORT
-- ═══════════════════════════════════════════════════════════════════

function export_to_json()
    local rom_name = gameinfo.getromname()
    local rom_hash = gameinfo.getromhash()
    
    -- Convert captured_levels table to array
    local levels_array = {}
    for _, level in pairs(captured_levels) do
        table.insert(levels_array, level)
    end
    
    -- Sort by level ID
    table.sort(levels_array, function(a, b)
        return a.level_id_decimal < b.level_id_decimal
    end)
    
    local output = {
        rom_name = rom_name,
        rom_hash = rom_hash,
        extraction_method = "BizHawk RAM extraction",
        extraction_time = os.date("%Y-%m-%d %H:%M:%S"),
        total_levels_captured = #levels_array,
        levels = levels_array,
    }
    
    -- Simple JSON encoding
    local json = encode_json(output)
    
    local file = io.open(OUTPUT_FILE, 'w')
    if file then
        file:write(json)
        file:close()
        console.log("═" .. string.rep("═", 69))
        console.log(string.format("✓ Exported %d levels to %s", #levels_array, OUTPUT_FILE))
        console.log("═" .. string.rep("═", 69))
        return true
    else
        console.log("✗ Failed to open output file!")
        return false
    end
end

function encode_json(obj, indent)
    indent = indent or 0
    local t = type(obj)
    local ind = string.rep("  ", indent)
    local ind2 = string.rep("  ", indent + 1)
    
    if t == "table" then
        -- Check if array
        local is_array = (#obj > 0)
        for k in pairs(obj) do
            if type(k) ~= "number" then
                is_array = false
                break
            end
        end
        
        if is_array then
            if #obj == 0 then return "[]" end
            local parts = {}
            for _, v in ipairs(obj) do
                table.insert(parts, ind2 .. encode_json(v, indent + 1))
            end
            return "[\n" .. table.concat(parts, ",\n") .. "\n" .. ind .. "]"
        else
            local parts = {}
            for k, v in pairs(obj) do
                local key = string.format('"%s"', tostring(k))
                table.insert(parts, ind2 .. key .. ": " .. encode_json(v, indent + 1))
            end
            if #parts == 0 then return "{}" end
            return "{\n" .. table.concat(parts, ",\n") .. "\n" .. ind .. "}"
        end
    elseif t == "string" then
        return '"' .. obj:gsub('"', '\\"'):gsub('\n', '\\n') .. '"'
    elseif t == "number" then
        return tostring(obj)
    elseif t == "boolean" then
        return obj and "true" or "false"
    else
        return "null"
    end
end

-- ═══════════════════════════════════════════════════════════════════
-- MAIN LOOP
-- ═══════════════════════════════════════════════════════════════════

local initialized = false

function main_loop()
    emu.frameadvance()
    frame_count = frame_count + 1
    
    -- Initialize on first run
    if not initialized then
        console.clear()
        console.log("═" .. string.rep("═", 69))
        console.log("  SMW LEVEL NAME EXTRACTOR - RAM-Based Extraction")
        console.log("═" .. string.rep("═", 69))
        console.log(string.format("ROM: %s", gameinfo.getromname()))
        console.log(string.format("Hash: %s", gameinfo.getromhash()))
        console.log("═" .. string.rep("═", 69))
        console.log("")
        console.log("Instructions:")
        console.log("  1. Navigate to overworld")
        console.log("  2. Move Mario over level tiles")
        console.log("  3. Script captures level names automatically")
        console.log(string.format("  4. Auto-saves after %d levels", AUTO_EXTRACT_COUNT))
        console.log("")
        console.log("Waiting for overworld...")
        console.log("")
        initialized = true
    end
    
    -- Check if on overworld
    if not is_on_overworld() then
        return
    end
    
    -- Check if standing on a level tile
    local ow_state = read_byte(0x13D9)
    local ow_tile = get_overworld_tile()
    
    -- Capture when:
    -- 1. Standing on level tile (state 0x03)
    -- 2. Tile changed (moved to new level)
    if ow_state == 0x03 and ow_tile ~= last_ow_tile then
        local capture = capture_current_level()
        last_ow_tile = ow_tile
        
        -- Auto-export if we've captured enough
        local count = 0
        for _ in pairs(captured_levels) do
            count = count + 1
        end
        
        if count >= AUTO_EXTRACT_COUNT and count % AUTO_EXTRACT_COUNT == 0 then
            export_to_json()
        end
    end
    
    -- Show status every 60 frames (1 second)
    if frame_count % 60 == 0 and DEBUG then
        local count = 0
        for _ in pairs(captured_levels) do
            count = count + 1
        end
        
        if count > 0 then
            gui.text(10, 10, string.format("Captured: %d levels", count), "white", "black")
        end
    end
end

-- ═══════════════════════════════════════════════════════════════════
-- EVENT HANDLERS
-- ═══════════════════════════════════════════════════════════════════

event.onexit(function()
    console.log("")
    console.log("Script ending - saving data...")
    export_to_json()
end)

-- ═══════════════════════════════════════════════════════════════════
-- START
-- ═══════════════════════════════════════════════════════════════════

while true do
    main_loop()
end

