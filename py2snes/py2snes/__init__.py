__version__ = '1.0.5'

import websockets
import json
from pathlib import Path

import asyncio
import aiofiles
import os

import logging

class usb2snesException(Exception):
    pass

SNES_DISCONNECTED = 0
SNES_CONNECTING = 1
SNES_CONNECTED = 2
SNES_ATTACHED = 3

ROM_START = 0x000000
WRAM_START = 0xF50000
WRAM_SIZE = 0x20000
SRAM_START = 0xE00000

# ========================================
# CONFIGURATION CONSTANTS
# ========================================

# PutFile chunk size (bytes)
# Recommended: 1024 bytes for better flow control
# May use 4096 for faster transfers on stable connections
DEFAULT_CHUNK_SIZE = 1024
CHUNK_SIZE = int(os.environ.get('USB2SNES_CHUNK_SIZE', DEFAULT_CHUNK_SIZE))

# Directory pre-creation
PREEMPTIVE_DIR_CREATE = os.environ.get('USB2SNES_PREEMPTIVE_DIR', 'true').lower() != 'false'

# Upload verification
VERIFY_AFTER_UPLOAD = os.environ.get('USB2SNES_VERIFY_UPLOAD', 'true').lower() != 'false'

# Blocking upload timeout (seconds per MB)
BLOCKING_TIMEOUT_PER_MB = int(os.environ.get('USB2SNES_TIMEOUT_PER_MB', '10'))

# Savestate configuration
SAVESTATE_SIZE = 320 * 1024  # 320KB
SAVESTATE_DATA_ADDRESS = 0xF00000
SAVESTATE_INTERFACE_ADDRESS_OLD = 0xFC2000  # Firmware < 11
SAVESTATE_INTERFACE_ADDRESS_NEW = 0xFE1000  # Firmware >= 11

class snes():
    def __init__(self):
        self.state = SNES_DISCONNECTED
        self.socket = None
        self.recv_queue = asyncio.Queue()
        self.request_lock = asyncio.Lock()
        self.is_sd2snes = False
        # self.attached = False
        
        # Configuration (can be overridden per instance)
        self.chunk_size = CHUNK_SIZE
        self.preemptive_dir_create = PREEMPTIVE_DIR_CREATE
        self.verify_after_upload = VERIFY_AFTER_UPLOAD
        
        # Savestate configuration
        self.savestate_interface_address = SAVESTATE_INTERFACE_ADDRESS_OLD
        self.savestate_data_address = SAVESTATE_DATA_ADDRESS
        self.firmware_version = None
        
        logging.info(f'[py2snes] Configuration:')
        logging.info(f'  Chunk size: {self.chunk_size} bytes')
        logging.info(f'  Preemptive dir create: {self.preemptive_dir_create}')
        logging.info(f'  Verify after upload: {self.verify_after_upload}')

    async def connect(self, address='ws://localhost:8080'):
        if self.socket is not None:
            print('Already connected to snes')
            return

        self.state = SNES_CONNECTING
        recv_task = None

        print("Connecting to QUsb2snes at %s ..." % address)

        try:
            self.socket = await websockets.connect(address, ping_timeout=None, ping_interval=None)
            self.state = SNES_CONNECTED
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.state = SNES_DISCONNECTED

        self.recv_task = asyncio.create_task(self.recv_loop())

    async def DeviceList(self):
        await self.request_lock.acquire()

        if self.state < SNES_CONNECTED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                "Opcode" : "DeviceList",
                "Space" : "SNES",
            }
            await self.socket.send(json.dumps(request))

            reply = json.loads(await asyncio.wait_for(self.recv_queue.get(), 5))
            devices = reply['Results'] if 'Results' in reply and len(reply['Results']) > 0 else None

            if not devices:
                raise Exception('No device found')

            return devices
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.state = SNES_DISCONNECTED
        finally:
            self.request_lock.release()

    async def Attach(self, device):
        if self.state != SNES_CONNECTED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                "Opcode" : "Attach",
                "Space" : "SNES",
                "Operands" : [device]
            }
            await self.socket.send(json.dumps(request))
            self.state = SNES_ATTACHED

            if 'SD2SNES'.lower() in device.lower() or (len(device) == 4 and device[:3] == 'COM'):
                self.is_sd2snes = True
            else:
                self.is_sd2snes = False

            self.device = device

        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.snes_state = SNES_DISCONNECTED

    async def Info(self):
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return None
            try:
                request = {
                    "Opcode" : "Info",
                    "Space" : "SNES",
                    "Operands" : [self.device]
                }
                await self.socket.send(json.dumps(request))
                reply = json.loads(await asyncio.wait_for(self.recv_queue.get(), 5))
                info = reply['Results'] if 'Results' in reply and len(reply['Results']) > 0 else None
                return {
                    "firmwareversion": _listitem(info,0),
                    "versionstring": _listitem(info,1),
                    "romrunning": _listitem(info,2),
                    "flag1": _listitem(info,3),
                    "flag2": _listitem(info,4),
                }
            except Exception as e:
                if self.socket is not None:
                    if not self.socket.closed:
                        await self.socket.close()
                    self.socket = None
                self.snes_state = SNES_DISCONNECTED
        finally:
            self.request_lock.release()

    async def Name(self, name):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                "Opcode" : "Name",
                "Space" : "SNES",
                "Operands" : [name]
            }
            await self.socket.send(json.dumps(request))
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.state = SNES_DISCONNECTED

    async def Boot(self, rom):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                "Opcode" : "Boot",
                "Space" : "SNES",
                "Operands" : [rom]
            }
            await self.socket.send(json.dumps(request))
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.state = SNES_DISCONNECTED

    async def Menu(self):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                "Opcode" : "Menu",
                "Space" : "SNES",
            }
            print(json.dumps(request))
            await self.socket.send(json.dumps(request))
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.state = SNES_DISCONNECTED

    async def Reset(self):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                "Opcode" : "Reset",
                "Space" : "SNES",
            }
            await self.socket.send(json.dumps(request))
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.state = SNES_DISCONNECTED

    async def GetAddress(self, address, size):
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return None

            GetAddress_Request = {
                "Opcode" : "GetAddress",
                "Space" : "SNES",
                "Operands" : [hex(address)[2:], hex(size)[2:]]
            }
            try:
                await self.socket.send(json.dumps(GetAddress_Request))
            except websockets.ConnectionClosed:
                return None

            data = bytes()
            while len(data) < size:
                try:
                    data += await asyncio.wait_for(self.recv_queue.get(), 5)
                except asyncio.TimeoutError:
                    break

            if len(data) != size:
                print('Error reading %s, requested %d bytes, received %d' % (hex(address), size, len(data)))
                if len(data):
                    print(str(data))
                if self.socket is not None and not self.socket.closed:
                    await self.socket.close()
                return None

            return data
        finally:
            self.request_lock.release()

    async def GetAddresses(self, address_list):
        """
        Read multiple memory addresses in a single call (batch operation)
        Much more efficient than multiple GetAddress calls - single WebSocket round-trip
        Perfect for polling game state or reading multiple variables at once
        
        Args:
            address_list: List of (address, size) tuples
        
        Returns:
            List of bytes objects (one per address, in order)
        """
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return None

            # Build operands: addr1, size1, addr2, size2, ...
            operands = []
            total_size = 0
            
            for address, size in address_list:
                operands.append(hex(address)[2:])
                operands.append(hex(size)[2:])
                total_size += size

            request = {
                "Opcode" : "GetAddress",
                "Space" : "SNES",
                "Operands" : operands
            }
            
            logging.info(f'[py2snes] Batch read: {len(address_list)} addresses ({total_size} bytes total)')
            
            try:
                await self.socket.send(json.dumps(request))
            except websockets.ConnectionClosed:
                return None

            # Read all binary data
            data = bytes()
            while len(data) < total_size:
                try:
                    data += await asyncio.wait_for(self.recv_queue.get(), 5)
                except asyncio.TimeoutError:
                    break

            if len(data) != total_size:
                logging.error(f'[py2snes] Batch read error: requested {total_size} bytes, received {len(data)}')
                if self.socket is not None and not self.socket.closed:
                    await self.socket.close()
                return None

            # Split data into individual results according to requested sizes
            results = []
            consumed = 0
            
            for address, size in address_list:
                results.append(data[consumed:consumed + size])
                consumed += size

            logging.info(f'[py2snes] Batch read complete: {len(results)} addresses retrieved')
            return results
        finally:
            self.request_lock.release()

    async def PutAddress(self, write_list):
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return False

            PutAddress_Request = {
                "Opcode" : "PutAddress",
                "Operands" : []
            }

            if self.is_sd2snes:
                cmd = b'\x00\xE2\x20\x48\xEB\x48'

                for address, data in write_list:
                    if (address < WRAM_START) or ((address + len(data)) > (WRAM_START + WRAM_SIZE)):
                        print("SD2SNES: Write out of range %s (%d)" % (hex(address), len(data)))
                        return False
                    for ptr, byte in enumerate(data, address + 0x7E0000 - WRAM_START):
                        cmd += b'\xA9' # LDA
                        cmd += bytes([byte])
                        cmd += b'\x8F' # STA.l
                        cmd += bytes([ptr & 0xFF, (ptr >> 8) & 0xFF, (ptr >> 16) & 0xFF])

                cmd += b'\xA9\x00\x8F\x00\x2C\x00\x68\xEB\x68\x28\x6C\xEA\xFF\x08'

                PutAddress_Request['Space'] = 'CMD'
                PutAddress_Request['Operands'] = ["2C00", hex(len(cmd)-1)[2:], "2C00", "1"]
                try:
                    if self.socket is not None:
                        await self.socket.send(json.dumps(PutAddress_Request))
                    if self.socket is not None:
                        await self.socket.send(cmd)
                except websockets.ConnectionClosed:
                    return False
            else:
                PutAddress_Request['Space'] = 'SNES'
                try:
                    #will pack those requests as soon as qusb2snes actually supports that for real
                    for address, data in write_list:
                        PutAddress_Request['Operands'] = [hex(address)[2:], hex(len(data))[2:]]
                        if self.socket is not None:
                            await self.socket.send(json.dumps(PutAddress_Request))
                        if self.socket is not None:
                            await self.socket.send(data)
                except websockets.ConnectionClosed:
                    return False

            return True
        finally:
            self.request_lock.release()

    # async def GetFile(self, filepath):
    #     try:
    #         await self.request_lock.acquire()

    #         if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
    #             return None

    #         request = {
    #             "Opcode" : "GetFile",
    #             "Space" : "SNES",
    #             "Operands" : [filepath]
    #         }
    #         try:
    #             await self.socket.send(json.dumps(request))
    #         except websockets.ConnectionClosed:
    #             return None

    #         data = bytes()
    #         while len(data) < size:
    #             try:
    #                 data += await asyncio.wait_for(self.recv_queue.get(), 5)
    #             except asyncio.TimeoutError:
    #                 break

    #         if len(data) != size:
    #             print('Error reading %s, requested %d bytes, received %d' % (hex(address), size, len(data)))
    #             if len(data):
    #                 print(str(data))
    #             if self.socket is not None and not self.socket.closed:
    #                 await self.socket.close()
    #             return None

    #         return data
    #     finally:
    #         self.request_lock.release()

    # ========================================
    # Savestate Management (Phase 3)
    # ========================================

    async def CheckSavestateSupport(self):
        """
        Check if savestate support is available (ROM must be patched)
        
        Returns:
            True if savestate support detected
        """
        try:
            # Try to read interface address
            interface_data = await self.GetAddress(self.savestate_interface_address, 2)
            # If we can read it without error, support may be present
            return interface_data is not None
        except Exception as error:
            return False

    async def WaitForSafeState(self, timeout_ms=5000):
        """
        Wait for safe state (both saveState and loadState flags are 0)
        
        Args:
            timeout_ms: Timeout in milliseconds
        
        Returns:
            True if safe state reached
        """
        start_time = time.time()
        
        while (time.time() - start_time) < (timeout_ms / 1000):
            flags = await self.GetAddress(self.savestate_interface_address, 2)
            if flags[0] == 0 and flags[1] == 0:
                return True
            await asyncio.sleep(0.03)  # Poll every 30ms
        
        raise TimeoutError('Timeout waiting for safe state')

    async def SaveStateToMemory(self, trigger=True):
        """
        Save state to memory (reads 320KB savestate data)
        
        Args:
            trigger: If True, triggers save via interface; if False, reads existing data
        
        Returns:
            320KB savestate data (bytes)
        """
        try:
            logging.info('[py2snes] Saving state...')
            
            # Wait for safe state
            await self.WaitForSafeState(5000)
            
            if trigger:
                # Trigger save by writing 1 to saveState flag
                await self.PutAddress([[self.savestate_interface_address, bytes([1, 0])]])
                
                # Wait for save to complete (flag returns to 0)
                await asyncio.sleep(0.1)  # Small delay for save to start
                await self.WaitForSafeState(10000)  # Wait up to 10s for save to complete
            
            # Read savestate data (320KB)
            logging.info('[py2snes] Reading savestate data (320KB)...')
            savestate_data = await self.GetAddress(self.savestate_data_address, SAVESTATE_SIZE)
            
            if not savestate_data or len(savestate_data) != SAVESTATE_SIZE:
                raise ValueError(f'Invalid savestate data size: {len(savestate_data) if savestate_data else 0} bytes')
            
            logging.info('[py2snes] Savestate captured successfully')
            return savestate_data
        except Exception as error:
            logging.error(f'[py2snes] SaveStateToMemory error: {error}')
            raise

    async def LoadStateFromMemory(self, savestate_data):
        """
        Load state from memory (writes 320KB savestate data and triggers load)
        
        Args:
            savestate_data: 320KB savestate data (bytes)
        
        Returns:
            Success status (bool)
        """
        try:
            if not savestate_data or len(savestate_data) != SAVESTATE_SIZE:
                raise ValueError(f'Invalid savestate data size: {len(savestate_data) if savestate_data else 0} bytes (expected {SAVESTATE_SIZE})')
            
            logging.info('[py2snes] Loading state...')
            
            # Wait for safe state
            await self.WaitForSafeState(5000)
            
            # Write savestate data to memory (320KB)
            logging.info('[py2snes] Writing savestate data (320KB)...')
            await self.PutAddress([[self.savestate_data_address, savestate_data]])
            
            # Trigger load by writing 1 to loadState flag
            await self.PutAddress([[self.savestate_interface_address + 1, bytes([1])]])
            
            # Wait for load to complete
            await asyncio.sleep(0.1)
            await self.WaitForSafeState(10000)
            
            logging.info('[py2snes] Savestate loaded successfully')
            return True
        except Exception as error:
            logging.error(f'[py2snes] LoadStateFromMemory error: {error}')
            raise

    def set_firmware_version(self, firmware_version):
        """
        Set firmware version and update savestate interface address
        Should be called after connecting and getting Info()
        
        Args:
            firmware_version: Firmware version string (e.g., "11.0")
        """
        self.firmware_version = firmware_version
        
        # Parse version number
        import re
        version_match = re.search(r'(\d+)', firmware_version)
        if version_match:
            major_version = int(version_match.group(1))
            if major_version >= 11:
                self.savestate_interface_address = SAVESTATE_INTERFACE_ADDRESS_NEW
                logging.info('[py2snes] Using new savestate interface address (firmware 11+)')
            else:
                self.savestate_interface_address = SAVESTATE_INTERFACE_ADDRESS_OLD
                logging.info('[py2snes] Using old savestate interface address (firmware < 11)')

    # ========================================
    # Memory Watching System (Phase 3)
    # ========================================

    def create_memory_watcher(self, addresses, poll_rate=0.1, on_change=None):
        """
        Create a memory watcher for multiple addresses
        Returns an object with start/stop/get_values methods
        
        Args:
            addresses: List of (address, size) tuples
            poll_rate: Poll rate in seconds (default: 0.1 = 100ms = 10Hz)
            on_change: Callback(changes) when values change
        
        Returns:
            Watcher object with start(), stop(), get_values(), is_running
        """
        class MemoryWatcher:
            def __init__(watcher_self, snes_instance, addresses, poll_rate, on_change):
                watcher_self.snes = snes_instance
                watcher_self.addresses = addresses
                watcher_self.poll_rate = poll_rate
                watcher_self.on_change = on_change
                watcher_self.previous_values = None
                watcher_self.is_running = False
                watcher_self.task = None
            
            async def start(watcher_self):
                if watcher_self.is_running:
                    logging.warning('[MemoryWatcher] Already running')
                    return
                
                logging.info(f'[MemoryWatcher] Starting watcher ({len(watcher_self.addresses)} addresses, {watcher_self.poll_rate}s poll rate)')
                watcher_self.is_running = True
                
                # Initial read
                watcher_self.previous_values = await watcher_self.snes.GetAddresses(watcher_self.addresses)
                
                # Start polling
                watcher_self.task = asyncio.create_task(watcher_self._poll_loop())
            
            async def _poll_loop(watcher_self):
                while watcher_self.is_running:
                    try:
                        await asyncio.sleep(watcher_self.poll_rate)
                        current_values = await watcher_self.snes.GetAddresses(watcher_self.addresses)
                        
                        # Detect changes
                        changes = []
                        for i in range(len(current_values)):
                            if watcher_self.previous_values[i] != current_values[i]:
                                changes.append({
                                    'index': i,
                                    'address': watcher_self.addresses[i][0],
                                    'size': watcher_self.addresses[i][1],
                                    'old_value': bytes(watcher_self.previous_values[i]),
                                    'new_value': bytes(current_values[i])
                                })
                        
                        # Call on_change callback if changes detected
                        if changes and watcher_self.on_change:
                            watcher_self.on_change(changes)
                        
                        watcher_self.previous_values = current_values
                    except Exception as error:
                        logging.error(f'[MemoryWatcher] Poll error: {error}')
                        # Continue watching despite errors
            
            def stop(watcher_self):
                if not watcher_self.is_running:
                    return
                
                logging.info('[MemoryWatcher] Stopping watcher')
                watcher_self.is_running = False
                if watcher_self.task:
                    watcher_self.task.cancel()
                    watcher_self.task = None
            
            def get_values(watcher_self):
                return [bytes(v) for v in watcher_self.previous_values] if watcher_self.previous_values else None
        
        return MemoryWatcher(self, addresses, poll_rate, on_change)

    async def watch_for_value(self, address, size, target_value, timeout_ms=30000, poll_rate=0.1):
        """
        Watch single address for specific value
        Resolves when target value is detected or timeout occurs
        
        Args:
            address: Memory address
            size: Number of bytes
            target_value: Value to watch for (bytes, int, or predicate function)
            timeout_ms: Timeout in milliseconds (0 = no timeout)
            poll_rate: Poll rate in seconds
        
        Returns:
            The value when condition is met
        """
        start_time = time.time()
        
        # Convert target_value to check function
        if callable(target_value):
            check_func = target_value
        elif isinstance(target_value, int):
            check_func = lambda buf: buf[0] == target_value
        elif isinstance(target_value, bytes):
            check_func = lambda buf: buf == target_value
        else:
            raise ValueError('target_value must be bytes, int, or function')
        
        while True:
            # Check timeout
            if timeout_ms > 0 and (time.time() - start_time) > (timeout_ms / 1000):
                raise TimeoutError('Watch timeout')
            
            # Read current value
            current_value = await self.GetAddress(address, size)
            
            # Check condition
            if check_func(current_value):
                return current_value
            
            # Wait before next poll
            await asyncio.sleep(poll_rate)

    async def watch_for_conditions(self, conditions, timeout_ms=30000, poll_rate=0.1):
        """
        Watch multiple addresses until all conditions are met
        
        Args:
            conditions: List of dicts with 'address', 'size', 'value'
            timeout_ms: Timeout in milliseconds
            poll_rate: Poll rate in seconds
        
        Returns:
            Values when all conditions met
        """
        start_time = time.time()
        addresses = [(c['address'], c['size']) for c in conditions]
        
        # Build check functions
        check_funcs = []
        for c in conditions:
            value = c['value']
            if callable(value):
                check_funcs.append(value)
            elif isinstance(value, int):
                check_funcs.append(lambda buf: buf[0] == value)
            elif isinstance(value, bytes):
                check_funcs.append(lambda buf: buf == value)
            else:
                raise ValueError('condition.value must be bytes, int, or function')
        
        while True:
            # Check timeout
            if timeout_ms > 0 and (time.time() - start_time) > (timeout_ms / 1000):
                raise TimeoutError('Watch timeout - not all conditions met')
            
            # Read all addresses
            values = await self.GetAddresses(addresses)
            
            # Check all conditions
            all_met = all(check_funcs[i](values[i]) for i in range(len(values)))
            
            if all_met:
                return values
            
            # Wait before next poll
            await asyncio.sleep(poll_rate)

    async def PutFile(self, srcfile, dstfile, progress_callback=None):
        """
        Upload a file to the console
        Improved version with directory creation, backpressure, and verification
        
        Args:
            srcfile: Source file path (local)
            dstfile: Destination file path (on console)
            progress_callback: Optional callback function(transferred, total) for progress updates
        """
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return None

            # Preemptive directory creation (if enabled)
            if self.preemptive_dir_create:
                dirpath = dstfile.rsplit('/', 1)[0] if '/' in dstfile else '/'
                if dirpath != '/':
                    try:
                        await self.List(dirpath)
                        logging.info(f'[py2snes] Directory exists: {dirpath}')
                    except Exception as e:
                        logging.info(f'[py2snes] Creating directory: {dirpath}')
                        try:
                            await self.MakeDir(dirpath)
                            logging.info(f'[py2snes] Directory created: {dirpath}')
                        except Exception as mkdir_error:
                            logging.error(f'[py2snes] Failed to create directory: {mkdir_error}')
                            raise usb2snesException(f'Cannot create directory {dirpath}: {mkdir_error}')

            size = os.path.getsize(srcfile)
            transferred = 0
            
            # Initial progress callback
            if progress_callback:
                progress_callback(0, size)
            
            async with aiofiles.open(srcfile, 'rb') as infile:
                request = {
                    "Opcode" : "PutFile",
                    "Space" : "SNES",
                    "Operands" : [dstfile, hex(size)[2:]]
                }
                try:
                    if self.socket is not None:
                        await self.socket.send(json.dumps(request))
                    if self.socket is not None:
                        while True:
                            chunk = await infile.read(self.chunk_size)
                            if not chunk: break
                            await self.socket.send(chunk)
                            transferred += len(chunk)
                            
                            # Progress callback
                            if progress_callback:
                                progress_callback(transferred, size)
                            
                            # Log progress for large files
                            if size > 1024*1024 and transferred % (512*1024) == 0:
                                logging.info(f'[py2snes] Upload progress: {round(transferred/size*100)}%')
                except websockets.ConnectionClosed:
                    return False

                # Verify byte count
                if transferred != size:
                    raise usb2snesException(f'Transfer incomplete: {transferred}/{size} bytes')
                
                logging.info(f'[py2snes] Transferred {transferred} bytes')

                # Verification after upload (if enabled)
                if self.verify_after_upload:
                    await self._verify_upload(dstfile, size)

                return True
        finally:
            self.request_lock.release()

    async def _verify_upload(self, dstfile, expected_size):
        """
        Verify uploaded file exists and is accessible
        """
        dirpath = dstfile.rsplit('/', 1)[0] if '/' in dstfile else '/'
        filename = dstfile.rsplit('/', 1)[1] if '/' in dstfile else dstfile
        
        # Wait for device to finish writing
        await asyncio.sleep(1)
        
        # Check file exists
        try:
            files = await self.List(dirpath)
            # files is list of dicts with 'filename' and 'type'
            if not any(f['filename'] == filename for f in files):
                raise usb2snesException(f'File {filename} not found after upload')
            
            logging.info(f'[py2snes] Upload verified: {dstfile}')
        except Exception as error:
            logging.error(f'[py2snes] Verification failed: {error}')
            raise usb2snesException(f'Upload verification failed: {error}')

    async def PutFileBlocking(self, srcfile, dstfile, timeout_seconds=None, progress_callback=None):
        """
        Blocking file upload - waits for completion with timeout
        
        Args:
            srcfile: Source file path (local)
            dstfile: Destination file path (on console)
            timeout_seconds: Timeout in seconds (None = auto-calculate based on file size)
            progress_callback: Optional callback function(transferred, total) for progress updates
        
        Returns:
            True on success
        
        Raises:
            asyncio.TimeoutError: If upload times out
            usb2snesException: If upload fails
        """
        try:
            size = os.path.getsize(srcfile)
            
            # Calculate timeout based on file size if not specified
            if timeout_seconds is None:
                size_mb = size / (1024 * 1024)
                timeout_seconds = max(30, size_mb * BLOCKING_TIMEOUT_PER_MB)  # Minimum 30 seconds
            
            logging.info(f'[py2snes] PutFileBlocking: {srcfile} -> {dstfile} ({size} bytes, timeout: {timeout_seconds}s)')
            
            # Upload with timeout and progress callback
            result = await asyncio.wait_for(self.PutFile(srcfile, dstfile, progress_callback), timeout=timeout_seconds)
            
            logging.info(f'[py2snes] PutFileBlocking completed successfully')
            return result
        except asyncio.TimeoutError:
            logging.error(f'[py2snes] Upload timeout after {timeout_seconds}s (file size: {size} bytes)')
            raise
        except Exception as error:
            logging.error(f'[py2snes] PutFileBlocking error: {error}')
            raise

    async def GetFile(self, filepath, progress_callback=None):
        """
        Download a file from the console
        
        Args:
            filepath: File path on console
            progress_callback: Optional callback function(received, total) for progress updates
        
        Returns:
            bytes: File data
        
        Raises:
            usb2snesException: If download fails
        """
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return None

            request = {
                "Opcode" : "GetFile",
                "Space" : "SNES",
                "Operands" : [filepath]
            }
            
            try:
                await self.socket.send(json.dumps(request))
            except Exception as e:
                raise usb2snesException(f'Failed to send GetFile request: {e}')

            # Get size from reply
            try:
                reply = json.loads(await asyncio.wait_for(self.recv_queue.get(), 5))
                size_hex = reply['Results'][0]
                size = int(size_hex, 16)
            except Exception as e:
                raise usb2snesException(f'Failed to get file size: {e}')

            logging.info(f'[py2snes] Getting file: {filepath} ({size} bytes)')

            # Initial progress callback
            if progress_callback:
                progress_callback(0, size)

            # Read binary data until complete
            data = bytes()
            last_progress = 0
            
            while len(data) < size:
                try:
                    chunk = await asyncio.wait_for(self.recv_queue.get(), 10)
                except asyncio.TimeoutError:
                    raise usb2snesException(f'GetFile timeout waiting for data (received {len(data)}/{size} bytes)')
                
                data += chunk

                # Progress callback
                if progress_callback:
                    progress_callback(len(data), size)

                # Log progress for large files
                if size > 1024*1024 and len(data) - last_progress >= 512*1024:
                    logging.info(f'[py2snes] Download progress: {round(len(data)/size*100)}%')
                    last_progress = len(data)

            # Verify size
            if len(data) != size:
                raise usb2snesException(f'GetFile incomplete: received {len(data)}/{size} bytes')

            logging.info(f'[py2snes] Downloaded {len(data)} bytes')
            return data
        finally:
            self.request_lock.release()

    async def GetFileBlocking(self, filepath, timeout_seconds=None, progress_callback=None):
        """
        Blocking file download - waits for completion with timeout
        
        Args:
            filepath: File path on console
            timeout_seconds: Timeout in seconds (None = 5 minutes default)
            progress_callback: Optional callback function(received, total) for progress updates
        
        Returns:
            bytes: File data
        
        Raises:
            asyncio.TimeoutError: If download times out
            usb2snesException: If download fails
        """
        try:
            # Default 5 minute timeout for downloads
            if timeout_seconds is None:
                timeout_seconds = 300
            
            logging.info(f'[py2snes] GetFileBlocking: {filepath} (timeout: {timeout_seconds}s)')
            
            # Download with timeout and progress callback
            result = await asyncio.wait_for(self.GetFile(filepath, progress_callback), timeout=timeout_seconds)
            
            logging.info(f'[py2snes] GetFileBlocking completed successfully')
            return result
        except asyncio.TimeoutError:
            logging.error(f'[py2snes] Download timeout after {timeout_seconds}s')
            raise
        except Exception as error:
            logging.error(f'[py2snes] GetFileBlocking error: {error}')
            raise

    async def recv_loop(self):
        try:
            async for msg in self.socket:
                self.recv_queue.put_nowait(msg)
        except Exception as e:
            if type(e) is not websockets.ConnectionClosed:
                logging.exception(e)
        finally:
            socket, self.socket = self.socket, None
            if socket is not None and not socket.closed:
                await socket.close()

            self.state = SNES_DISCONNECTED
            self.recv_queue = asyncio.Queue()

    async def List(self,dirpath):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        elif not dirpath.startswith('/') and not dirpath in ['','/']:
            raise usb2snesException("Path \"{path}\" should start with \"/\"".format(
                path=dirpath
            ))
        elif dirpath.endswith('/') and not dirpath in ['','/']:
            raise usb2snesException("Path \"{path}\" should not end with \"/\"".format(
                path=dirpath
            ))

        if not dirpath in ['','/']:
            path = dirpath.lower().split('/')
            for idx, node in enumerate(path):
                if node == '':
                    continue
                else:
                    parent = '/'.join(path[:idx])
                    parentlist = await self._list(parent)
                    
                    if any(d['filename'].lower() == node for d in parentlist):
                        continue
                    else:
                        raise FileNotFoundError("directory {path} does not exist on usb2snes.".format(
                            path=dirpath
                        ))
            return await self._list(dirpath)
        else:
            return await self._list(dirpath)

    async def _list(self, dirpath):
        try:
            await self.request_lock.acquire()

            if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
                return None
            try:
                request = {
                    'Opcode': 'List',
                    'Space': 'SNES',
                    'Flags': None,
                    'Operands': [dirpath]
                }
                await self.socket.send(json.dumps(request))
                results = json.loads(await asyncio.wait_for(self.recv_queue.get(), 5))['Results']

                resultlist = []
                for filetype, filename in zip(results[::2], results[1::2]):
                    resultdict = {
                        "type": filetype,
                        "filename": filename
                    }
                    if not filename in ['.','..']:
                        resultlist.append(resultdict)
                return resultlist
            except Exception as e:
                if self.socket is not None:
                    if not self.socket.closed:
                        await self.socket.close()
                    self.socket = None
                self.snes_state = SNES_DISCONNECTED
        finally:
            self.request_lock.release()

    async def MakeDir(self,dirpath):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        if dirpath in ['','/']:
            raise usb2snesException('MakeDir: dirpath cannot be blank or \"/\"')

        path = dirpath.split('/')
        parent = '/'.join(path[:-1])
        parentdir = await self.List(parent)
        try:
            await self.List(dirpath)
        except FileNotFoundError as e:
            await self._mkdir(dirpath)

    async def _mkdir(self, dirpath):
        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                'Opcode': 'MakeDir',
                'Space': 'SNES',
                'Flags': None,
                'Operands': [dirpath]
            }
            await self.socket.send(json.dumps(request))
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.snes_state = SNES_DISCONNECTED

    async def Remove(self, dirpath):
        """this is pretty broken"""

        if self.state != SNES_ATTACHED or self.socket is None or not self.socket.open or self.socket.closed:
            return None
        try:
            request = {
                'Opcode': 'Remove',
                'Space': 'SNES',
                'Flags': None,
                'Operands': [dirpath]
            }
            await self.socket.send(json.dumps(request))
        except Exception as e:
            if self.socket is not None:
                if not self.socket.closed:
                    await self.socket.close()
                self.socket = None
            self.snes_state = SNES_DISCONNECTED

def _listitem(list, index):
    try:
        return list[index]
    except IndexError:
        return None
