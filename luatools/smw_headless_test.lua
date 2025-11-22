--[[
    SMW Headless Test Script for BizHawk
    Tests if a specific level loads correctly
    
    Usage:
        1. Set TARGET_LEVEL below (e.g., 0x106)
        2. Load ROM in BizHawk
        3. Tools > Lua Console
        4. Load this script
        5. Script will automatically:
           - Skip title screen
           - Enter overworld
           - Enter level
           - Check if target level loaded
           - Save results to test_results.json
]]

-- Configuration
local TARGET_LEVEL = 0x106  -- Change this to your target level
local MAX_FRAMES = 1800      -- 30 seconds at 60fps
local SCREENSHOT_DIR = nil   -- Set to directory path to enable screenshots, or nil to disable

-- State
local frame = 0
local test_complete = false
local ram_samples = {}
local screenshots = {}

-- RAM addresses to sample
local RAM_ADDRESSES = {
    {addr=0x0100, name="game_mode"},
    {addr=0x13BF, name="level_low"},
    {addr=0x17BB, name="level_backup"},
    {addr=0x0E, name="level_0E"},
    {addr=0x0F, name="level_high"},
    {addr=0x1F11, name="submap"},
    {addr=0x19D8, name="level_flags"},
}

-- Read WRAM byte
function read_wram(addr)
    memory.usememorydomain("WRAM")
    return memory.readbyte(addr)
end

-- Simple JSON encoder (BizHawk doesn't have json.encode)
function json_encode(obj)
    if type(obj) == "table" then
        local parts = {}
        local is_array = true
        local max_index = 0
        
        -- Check if it's an array
        for k, v in pairs(obj) do
            if type(k) ~= "number" then
                is_array = false
                break
            end
            if k > max_index then
                max_index = k
            end
        end
        
        if is_array then
            -- Array format
            for i = 1, max_index do
                table.insert(parts, json_encode(obj[i]))
            end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            -- Object format
            for k, v in pairs(obj) do
                local key = '"' .. tostring(k) .. '"'
                local value = json_encode(v)
                table.insert(parts, key .. ":" .. value)
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    elseif type(obj) == "string" then
        return '"' .. obj:gsub('"', '\\"') .. '"'
    elseif type(obj) == "number" then
        return tostring(obj)
    elseif type(obj) == "boolean" then
        return obj and "true" or "false"
    elseif obj == nil then
        return "null"
    else
        return '"' .. tostring(obj) .. '"'
    end
end

-- Sample RAM state
function sample_ram(frame_num)
    local sample = {
        frame = frame_num,
        time = frame_num / 60.0,  -- Assume 60fps
        ram = {}
    }
    
    for _, entry in ipairs(RAM_ADDRESSES) do
        sample.ram[entry.name] = read_wram(entry.addr)
    end
    
    -- Calculate full level ID
    local level_lo = sample.ram.level_low
    local level_hi_flags = sample.ram.level_flags
    local level_hi = level_hi_flags & 0x01
    local full_level = (level_hi * 256) + level_lo
    
    sample.ram.full_level_id = full_level
    sample.ram.game_mode_name = get_game_mode_name(sample.ram.game_mode)
    
    return sample
end

-- Get game mode name
function get_game_mode_name(mode)
    local modes = {
        [0x00] = "TitleScreen",
        [0x01] = "Intro",
        [0x02] = "TitleScreen2",
        [0x03] = "TitleScreen3",
        [0x0E] = "Overworld",
        [0x0F] = "Overworld2",
        [0x10] = "OWtoLevel",
        [0x11] = "MarioStart",
        [0x14] = "InLevel",
    }
    return modes[mode] or string.format("Unknown_0x%02X", mode)
end

-- Save test results to JSON
function save_results()
    local results = {
        target_level = TARGET_LEVEL,
        ram_samples = ram_samples,
        screenshots = screenshots,
        final_frame = frame,
        test_complete = test_complete
    }
    
    local json_file = "test_results.json"
    local json_str = json_encode(results)
    
    local f = io.open(json_file, "w")
    if f then
        f:write(json_str)
        f:close()
        print("Results saved to: " .. json_file)
    else
        print("ERROR: Could not write results file")
    end
end

-- Main test function
function run_test()
    frame = frame + 1
    
    -- Sample RAM every 60 frames (1 second)
    if frame % 60 == 0 then
        local sample = sample_ram(frame)
        table.insert(ram_samples, sample)
        
        -- Print status
        print(string.format("Frame %d: Mode=%s, Level=0x%03X, $13BF=0x%02X, $0F=0x%02X, Submap=0x%02X",
            frame, sample.ram.game_mode_name, sample.ram.full_level_id,
            sample.ram.level_low, sample.ram.level_high, sample.ram.submap))
        
        -- Capture screenshot at key moments
        if SCREENSHOT_DIR and (
            sample.ram.game_mode_name == "InLevel" or
            sample.ram.game_mode_name == "Overworld" or
            frame == 60 or frame == 120 or frame == 300
        ) then
            local screenshot_file = SCREENSHOT_DIR .. "/frame_" .. string.format("%06d", frame) .. ".png"
            gui.savescreenshot(screenshot_file)
            table.insert(screenshots, {
                frame = frame,
                file = screenshot_file
            })
        end
    end
    
    -- Input simulation
    local joypad_state = {}
    
    -- Press Start after 60 frames (skip title)
    if frame == 60 then
        joypad_state.Start = true
    elseif frame == 62 then
        joypad_state.Start = false
    -- Press Start again after 120 frames (enter game)
    elseif frame == 120 then
        joypad_state.Start = true
    elseif frame == 122 then
        joypad_state.Start = false
    -- After entering overworld, wait a bit then press Start to enter level
    elseif frame >= 300 and frame < 600 then
        local game_mode = read_wram(0x0100)
        if game_mode == 0x0E or game_mode == 0x0F then
            -- On overworld, press Start to enter level
            if frame == 300 then
                joypad_state.Start = true
            elseif frame == 302 then
                joypad_state.Start = false
            end
        end
    end
    
    joypad.set(1, joypad_state)
    
    -- Check if we're in the target level
    if frame >= 400 then
        local level_lo = read_wram(0x13BF)
        local level_hi_flags = read_wram(0x19D8)
        local level_hi = level_hi_flags & 0x01
        local full_level = (level_hi * 256) + level_lo
        
        if full_level == TARGET_LEVEL then
            print(string.format("SUCCESS: Target level 0x%03X loaded at frame %d", TARGET_LEVEL, frame))
            test_complete = true
            -- Sample one more time
            table.insert(ram_samples, sample_ram(frame))
            -- Wait a bit more to ensure level is fully loaded
            if frame >= 600 then
                emu.frameadvance()
                emu.frameadvance()
                emu.frameadvance()
                -- Final sample
                table.insert(ram_samples, sample_ram(frame + 3))
                -- Save results
                save_results()
                emu.exit()
            end
        end
    end
    
    -- Timeout check
    if frame >= MAX_FRAMES then
        print(string.format("TIMEOUT: Did not reach target level after %d frames", MAX_FRAMES))
        local last_sample = ram_samples[#ram_samples]
        if last_sample then
            print(string.format("Last level: 0x%03X, Mode: %s",
                last_sample.ram.full_level_id, last_sample.ram.game_mode_name))
        end
        save_results()
        emu.exit()
    end
    
    emu.frameadvance()
end

-- Register callback (try both API versions for compatibility)
if event and event.onframeend then
    event.onframeend(run_test)
elseif emu and emu.registerafter then
    emu.registerafter(run_test)
else
    print("ERROR: Could not register frame callback")
end

print("SMW Headless Test Script loaded")
print("Target level: 0x" .. string.format("%03X", TARGET_LEVEL))
print("Starting test...")

